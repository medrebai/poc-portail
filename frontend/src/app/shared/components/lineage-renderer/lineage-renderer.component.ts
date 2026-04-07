import {
  Component,
  ElementRef,
  Input,
  OnChanges,
  SimpleChanges,
  ViewChild,
  AfterViewInit,
} from '@angular/core';
import { LineageNode, LineageEdge } from '../../../services/lineage.service';

const SVG_NS = 'http://www.w3.org/2000/svg';

const TYPE_COLORS: Record<string, string> = {
  dataSource: '#4caf50',
  table: '#1565c0',
  measure: '#f9a825',
  column: '#42a5f5',
  visual: '#9c27b0',
};

const TYPE_LABELS: Record<string, string> = {
  dataSource: 'Data Sources',
  table: 'Tables',
  column: 'Columns',
  measure: 'Measures',
  visual: 'Visuals',
};

const COLUMN_ORDER = ['dataSource', 'table', 'column', 'measure', 'visual'];
const MAX_NODES_PER_TYPE = 50;
const MAX_EDGE_LABELS = 180;
const FULL_VIEW_EDGE_TYPES = new Set([
  'connects_to_source',
  'defined_in_table',
  'references_column',
  'depends_on_measure',
  'references_table',
  'uses_field',
  'has_relationship',
]);
const IMPACT_VIEW_EDGE_TYPES = new Set(['depends_on_measure', 'uses_field']);

const EDGE_COLORS: Record<string, string> = {
  uses_field: '#d32f2f',
  references_column: '#d32f2f',
  depends_on_measure: '#ef6c00',
  has_relationship: '#7b1fa2',
  connects_to_source: '#546e7a',
  belongs_to_table: '#90a4ae',
  defined_in_table: '#90a4ae',
  references_table: '#90a4ae',
};

const LABEL_EDGE_TYPES = new Set(['uses_field', 'references_column', 'depends_on_measure', 'has_relationship']);

const COL_WIDTH = 200;
const COL_GAP = 120;
const NODE_H = 55;
const NODE_GAP = 12;
const HEADER_H = 40;
const PADDING = 30;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;
const ZOOM_IN_STEP = 1.15;
const ZOOM_OUT_STEP = 0.85;
const PAN_SPEED = 1.35;

@Component({
  selector: 'app-lineage-renderer',
  standalone: true,
  imports: [],
  template: `<div class="lineage-svg-wrap" #svgWrap></div>`,
  styleUrl: './lineage-renderer.component.scss',
})
export class LineageRendererComponent implements OnChanges, AfterViewInit {
  @Input() nodes: LineageNode[] = [];
  @Input() edges: LineageEdge[] = [];
  @Input() zoom = 1;
  @Input() recenterToken = 0;
  @ViewChild('svgWrap') svgWrap!: ElementRef<HTMLDivElement>;

  private svg: SVGSVGElement | null = null;
  private mainGroup: SVGGElement | null = null;
  private panX = 0;
  private panY = 0;
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private panBaseX = 0;
  private panBaseY = 0;
  private nodePositions = new Map<string, { x: number; y: number }>();
  private fitCompensation = 1;
  private graphWidth = 0;
  private graphHeight = 0;

  ngAfterViewInit(): void {
    this.render();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.svgWrap) {
      const graphChanged = !!(changes['nodes'] || changes['edges']);
      const recenterChanged = !!changes['recenterToken'];
      const zoomChanged = !!changes['zoom'];

      if (graphChanged) {
        this.render();
        return;
      }

      if (recenterChanged) {
        this.centerView();
        this.applyTransform();
        return;
      }

      if (zoomChanged) {
        this.applyTransform();
        return;
      }
    }
  }

  resetView(): void {
    this.panX = 0;
    this.panY = 0;
    this.applyTransform();
  }

  private render(): void {
    if (!this.svgWrap) return;
    const wrap = this.svgWrap.nativeElement;
    wrap.innerHTML = '';
    this.nodePositions.clear();

    if (this.nodes.length === 0) return;

    const isImpactMode = this.nodes.some((n) => n.metadata?.['impactRole']);
    const activeColumns: Array<{
      type: string;
      nodes: LineageNode[];
      totalCount: number;
      label?: string;
      color?: string;
    }> = [];

    if (isImpactMode) {
      const sourceMeasures = this.nodes.filter((n) => n.type === 'measure' && n.metadata?.['impactRole'] === 'source');
      const dependentMeasures = this.nodes.filter((n) => n.type === 'measure' && n.metadata?.['impactRole'] === 'dependent');
      const visuals = this.nodes.filter((n) => n.type === 'visual');

      if (dependentMeasures.length > 0) {
        activeColumns.push({
          type: 'measure',
          nodes: dependentMeasures,
          totalCount: dependentMeasures.length,
          label: `Dependent Measures (${dependentMeasures.length})`,
          color: TYPE_COLORS['measure'],
        });
      }
      if (sourceMeasures.length > 0) {
        activeColumns.push({
          type: 'measure',
          nodes: sourceMeasures,
          totalCount: sourceMeasures.length,
          label: `Source Measure (${sourceMeasures.length})`,
          color: TYPE_COLORS['measure'],
        });
      }
      if (visuals.length > 0) {
        activeColumns.push({
          type: 'visual',
          nodes: visuals,
          totalCount: visuals.length,
          label: `Visuals (${visuals.length})`,
          color: TYPE_COLORS['visual'],
        });
      }
    } else {
      // Group nodes by type into columns
      const columns = new Map<string, LineageNode[]>();
      for (const type of COLUMN_ORDER) {
        columns.set(type, []);
      }
      for (const node of this.nodes) {
        const list = columns.get(node.type);
        if (list) list.push(node);
      }

      // Remove empty columns
      for (const type of COLUMN_ORDER) {
        const list = columns.get(type)!;
        if (list.length > 0) {
          const visibleNodes = list.slice(0, MAX_NODES_PER_TYPE);
          const overflow = list.length - visibleNodes.length;
          if (overflow > 0) {
            visibleNodes.push({
              id: `more:${type}`,
              type: type as LineageNode['type'],
              name: `+ ${overflow} more...`,
              detail: 'Not rendered for readability',
              metadata: { isMoreNode: true },
            });
          }
          activeColumns.push({ type, nodes: visibleNodes, totalCount: list.length });
        }
      }
    }

    if (activeColumns.length === 0) return;

    // Calculate dimensions
    const maxNodesInCol = Math.max(...activeColumns.map((c) => c.nodes.length));
    const totalW =
      activeColumns.length * COL_WIDTH +
      (activeColumns.length - 1) * COL_GAP +
      PADDING * 2;
    const totalH =
      PADDING + HEADER_H + maxNodesInCol * (NODE_H + NODE_GAP) + PADDING;
    this.graphWidth = totalW;
    this.graphHeight = totalH;

    // The browser auto-fits the full SVG viewBox to the container, which makes
    // tall full-lineage graphs look tiny and short trace graphs look too large.
    // Compensate with a baseline scale so default zoom is visually consistent.
    this.fitCompensation = this.computeFitCompensation(totalW, totalH);

    // Create SVG
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
    svg.style.minHeight = '320px';
    svg.style.cursor = 'grab';
    this.svg = svg;

    // Defs for filters and markers
    const defs = document.createElementNS(SVG_NS, 'defs');

    // Drop shadow filter
    const filter = document.createElementNS(SVG_NS, 'filter');
    filter.setAttribute('id', 'nodeShadow');
    filter.setAttribute('x', '-10%');
    filter.setAttribute('y', '-10%');
    filter.setAttribute('width', '120%');
    filter.setAttribute('height', '130%');
    const feFlood = document.createElementNS(SVG_NS, 'feDropShadow');
    feFlood.setAttribute('dx', '0');
    feFlood.setAttribute('dy', '2');
    feFlood.setAttribute('stdDeviation', '3');
    feFlood.setAttribute('flood-color', 'rgba(0,0,0,0.08)');
    filter.appendChild(feFlood);
    defs.appendChild(filter);

    // Glow filter for hover
    const glowFilter = document.createElementNS(SVG_NS, 'filter');
    glowFilter.setAttribute('id', 'edgeGlow');
    glowFilter.setAttribute('x', '-20%');
    glowFilter.setAttribute('y', '-20%');
    glowFilter.setAttribute('width', '140%');
    glowFilter.setAttribute('height', '140%');
    const feGaussian = document.createElementNS(SVG_NS, 'feGaussianBlur');
    feGaussian.setAttribute('stdDeviation', '3');
    feGaussian.setAttribute('result', 'blur');
    glowFilter.appendChild(feGaussian);
    const feMerge = document.createElementNS(SVG_NS, 'feMerge');
    const feMergeNode1 = document.createElementNS(SVG_NS, 'feMergeNode');
    feMergeNode1.setAttribute('in', 'blur');
    feMerge.appendChild(feMergeNode1);
    const feMergeNode2 = document.createElementNS(SVG_NS, 'feMergeNode');
    feMergeNode2.setAttribute('in', 'SourceGraphic');
    feMerge.appendChild(feMergeNode2);
    glowFilter.appendChild(feMerge);
    defs.appendChild(glowFilter);

    svg.appendChild(defs);

    // Main group for pan/zoom
    const mainGroup = document.createElementNS(SVG_NS, 'g');
    this.mainGroup = mainGroup;
    svg.appendChild(mainGroup);

    // Draw column backgrounds and headers
    activeColumns.forEach((col, colIdx) => {
      const x = PADDING + colIdx * (COL_WIDTH + COL_GAP);
      const color = col.color || TYPE_COLORS[col.type] || '#888';

      // Column background
      const bg = document.createElementNS(SVG_NS, 'rect');
      bg.setAttribute('x', String(x - 8));
      bg.setAttribute('y', String(PADDING));
      bg.setAttribute('width', String(COL_WIDTH + 16));
      bg.setAttribute('height', String(totalH - PADDING * 2));
      bg.setAttribute('rx', '10');
      bg.setAttribute('fill', color);
      bg.setAttribute('fill-opacity', '0.04');
      bg.setAttribute('stroke', color);
      bg.setAttribute('stroke-opacity', '0.12');
      bg.setAttribute('stroke-width', '1');
      mainGroup.appendChild(bg);

      // Column header
      const headerGroup = document.createElementNS(SVG_NS, 'g');

      const headerBg = document.createElementNS(SVG_NS, 'rect');
      headerBg.setAttribute('x', String(x - 4));
      headerBg.setAttribute('y', String(PADDING + 4));
      headerBg.setAttribute('width', String(COL_WIDTH + 8));
      headerBg.setAttribute('height', String(HEADER_H - 4));
      headerBg.setAttribute('rx', '6');
      headerBg.setAttribute('fill', color);
      headerBg.setAttribute('fill-opacity', '0.1');
      headerGroup.appendChild(headerBg);

      const headerText = document.createElementNS(SVG_NS, 'text');
      headerText.setAttribute('x', String(x + COL_WIDTH / 2));
      headerText.setAttribute('y', String(PADDING + HEADER_H / 2 + 6));
      headerText.setAttribute('text-anchor', 'middle');
      headerText.setAttribute('font-size', '12');
      headerText.setAttribute('font-weight', '700');
      headerText.setAttribute('fill', color);
      headerText.textContent = col.label || `${TYPE_LABELS[col.type] || col.type} (${col.totalCount})`;
      headerGroup.appendChild(headerText);

      mainGroup.appendChild(headerGroup);
    });

    // Compute node positions and draw nodes
    activeColumns.forEach((col, colIdx) => {
      const colX = PADDING + colIdx * (COL_WIDTH + COL_GAP);

      col.nodes.forEach((node, nodeIdx) => {
        const nodeX = colX;
        const nodeY = PADDING + HEADER_H + 8 + nodeIdx * (NODE_H + NODE_GAP);
        this.nodePositions.set(node.id, { x: nodeX, y: nodeY });

        const nodeGroup = document.createElementNS(SVG_NS, 'g');
        nodeGroup.setAttribute('class', 'lineage-node');
        nodeGroup.setAttribute('data-node-id', node.id);

        // Node rectangle
        const isMoreNode = !!node.metadata?.['isMoreNode'];

        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', String(nodeX));
        rect.setAttribute('y', String(nodeY));
        rect.setAttribute('width', String(COL_WIDTH));
        rect.setAttribute('height', String(NODE_H));
        rect.setAttribute('rx', '8');
        rect.setAttribute('fill', isMoreNode ? '#f8fafc' : 'white');
        rect.setAttribute('stroke', isMoreNode ? '#cbd5e1' : '#e5e7eb');
        rect.setAttribute('stroke-width', '1.5');
        if (isMoreNode) {
          rect.setAttribute('stroke-dasharray', '6 3');
        }
        rect.setAttribute('filter', 'url(#nodeShadow)');
        nodeGroup.appendChild(rect);

        // Left accent bar
        const accent = document.createElementNS(SVG_NS, 'rect');
        accent.setAttribute('x', String(nodeX));
        accent.setAttribute('y', String(nodeY));
        accent.setAttribute('width', '4');
        accent.setAttribute('height', String(NODE_H));
        accent.setAttribute('rx', '8');
        accent.setAttribute('fill', TYPE_COLORS[node.type] || '#888');
        // Clip the accent to only show left rounded corners
        const clipRect = document.createElementNS(SVG_NS, 'rect');
        clipRect.setAttribute('x', String(nodeX));
        clipRect.setAttribute('y', String(nodeY));
        clipRect.setAttribute('width', '8');
        clipRect.setAttribute('height', String(NODE_H));
        clipRect.setAttribute('rx', '8');
        clipRect.setAttribute('fill', TYPE_COLORS[node.type] || '#888');
        nodeGroup.appendChild(clipRect);

        // Colored dot
        if (!isMoreNode) {
          const dot = document.createElementNS(SVG_NS, 'circle');
          dot.setAttribute('cx', String(nodeX + 18));
          dot.setAttribute('cy', String(nodeY + 20));
          dot.setAttribute('r', '5');
          dot.setAttribute('fill', TYPE_COLORS[node.type] || '#888');
          nodeGroup.appendChild(dot);
        }

        // Node name text
        const nameText = document.createElementNS(SVG_NS, 'text');
        nameText.setAttribute('x', String(nodeX + 30));
        nameText.setAttribute('y', String(nodeY + 23));
        nameText.setAttribute('font-size', '12');
        nameText.setAttribute('font-weight', isMoreNode ? '500' : '600');
        nameText.setAttribute('fill', isMoreNode ? '#94a3b8' : '#111827');
        nameText.textContent = this.truncateText(node.name, 22);
        nodeGroup.appendChild(nameText);

        // Detail text
        if (node.detail) {
          const detailText = document.createElementNS(SVG_NS, 'text');
          detailText.setAttribute('x', String(nodeX + 30));
          detailText.setAttribute('y', String(nodeY + 40));
          detailText.setAttribute('font-size', '10');
          detailText.setAttribute('fill', isMoreNode ? '#bdbdbd' : '#9ca3af');
          detailText.textContent = this.truncateText(node.detail, 26);
          nodeGroup.appendChild(detailText);
        }

        // Hover interaction
        if (!isMoreNode) {
          nodeGroup.addEventListener('mouseenter', () => {
            this.highlightConnected(node.id, true);
          });
          nodeGroup.addEventListener('mouseleave', () => {
            this.highlightConnected(node.id, false);
          });
        }

        // Tooltip via title element
        const title = document.createElementNS(SVG_NS, 'title');
        title.textContent = node.detail ? `${node.name}\n${node.detail}` : node.name;
        nodeGroup.appendChild(title);

        mainGroup.appendChild(nodeGroup);
      });
    });

    // Draw edges
    const edgesGroup = document.createElementNS(SVG_NS, 'g');
    edgesGroup.setAttribute('class', 'lineage-edges');
    // Insert edges behind nodes
    mainGroup.insertBefore(edgesGroup, mainGroup.children[activeColumns.length]);

    let labelCount = 0;
    for (const edge of this.edges) {
      if (isImpactMode) {
        if (!IMPACT_VIEW_EDGE_TYPES.has(edge.type)) continue;
      } else if (!FULL_VIEW_EDGE_TYPES.has(edge.type)) {
        continue;
      }

      const fromPos = this.nodePositions.get(edge.from);
      const toPos = this.nodePositions.get(edge.to);
      if (!fromPos || !toPos) continue;
      if (Math.abs(fromPos.x - toPos.x) < 20) continue;

      const isForward = fromPos.x <= toPos.x;
      const x1 = isForward ? fromPos.x + COL_WIDTH : fromPos.x;
      const y1 = fromPos.y + NODE_H / 2;
      const x2 = isForward ? toPos.x : toPos.x + COL_WIDTH;
      const y2 = toPos.y + NODE_H / 2;

      const dx = Math.abs(x2 - x1) * 0.5;
      const edgeColor = EDGE_COLORS[edge.type] || '#cbd5e1';

      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute(
        'd',
        `M ${x1},${y1} C ${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`
      );
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', edgeColor);
      path.setAttribute('stroke-opacity', '0.36');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('data-from', edge.from);
      path.setAttribute('data-to', edge.to);
      path.setAttribute('data-edge-type', edge.type || '');

      if (edge.style === 'dashed') {
        path.setAttribute('stroke-dasharray', '6 4');
      }

      edgesGroup.appendChild(path);

      if (edge.label && LABEL_EDGE_TYPES.has(edge.type) && labelCount < MAX_EDGE_LABELS) {
        labelCount += 1;
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const label = this.truncateText(edge.label, 22);

        const bg = document.createElementNS(SVG_NS, 'rect');
        bg.setAttribute('x', String(mx - 38));
        bg.setAttribute('y', String(my - 9));
        bg.setAttribute('width', '76');
        bg.setAttribute('height', '14');
        bg.setAttribute('rx', '7');
        bg.setAttribute('fill', 'rgba(255,255,255,0.85)');
        bg.setAttribute('stroke', 'rgba(226,232,240,0.95)');
        bg.setAttribute('stroke-width', '0.8');
        edgesGroup.appendChild(bg);

        const text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('x', String(mx));
        text.setAttribute('y', String(my + 1));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('font-size', '9');
        text.setAttribute('font-weight', '600');
        text.setAttribute('fill', edge.type === 'has_relationship' ? '#7f1d1d' : '#b91c1c');
        text.textContent = label;
        edgesGroup.appendChild(text);
      }
    }

    this.drawLegend(mainGroup, totalH);

    // Pan events
    svg.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return;
      this.isPanning = true;
      this.panStartX = e.clientX;
      this.panStartY = e.clientY;
      this.panBaseX = this.panX;
      this.panBaseY = this.panY;
      svg.style.cursor = 'grabbing';
    });

    svg.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.isPanning) return;
      const dx = (e.clientX - this.panStartX) * PAN_SPEED;
      const dy = (e.clientY - this.panStartY) * PAN_SPEED;
      this.panX = this.panBaseX + dx;
      this.panY = this.panBaseY + dy;
      this.applyTransform();
    });

    svg.addEventListener('mouseup', () => {
      this.isPanning = false;
      svg.style.cursor = 'grab';
    });

    svg.addEventListener('mouseleave', () => {
      this.isPanning = false;
      svg.style.cursor = 'grab';
    });

    // Zoom via mouse wheel
    svg.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const point = svg.createSVGPoint();
      point.x = e.clientX;
      point.y = e.clientY;
      const screenToSvg = svg.getScreenCTM()?.inverse();
      if (!screenToSvg) return;

      const cursor = point.matrixTransform(screenToSvg);
      const prevEffectiveZoom = this.zoom * this.fitCompensation;
      const graphX = (cursor.x - this.panX) / prevEffectiveZoom;
      const graphY = (cursor.y - this.panY) / prevEffectiveZoom;

      const delta = e.deltaY > 0 ? ZOOM_OUT_STEP : ZOOM_IN_STEP;
      this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * delta));

      const nextEffectiveZoom = this.zoom * this.fitCompensation;
      this.panX = cursor.x - graphX * nextEffectiveZoom;
      this.panY = cursor.y - graphY * nextEffectiveZoom;
      this.applyTransform();
    });

    this.centerView();
    this.applyTransform();
    wrap.appendChild(svg);
  }

  private centerView(): void {
    if (!this.graphWidth || !this.graphHeight) return;
    const effectiveZoom = this.zoom * this.fitCompensation;
    this.panX = (this.graphWidth * (1 - effectiveZoom)) / 2;
    this.panY = (this.graphHeight * (1 - effectiveZoom)) / 2;
  }

  private applyTransform(): void {
    if (!this.mainGroup) return;
    const effectiveZoom = this.zoom * this.fitCompensation;
    this.mainGroup.setAttribute(
      'transform',
      `translate(${this.panX}, ${this.panY}) scale(${effectiveZoom})`
    );
  }

  private highlightConnected(nodeId: string, highlight: boolean): void {
    if (!this.svg) return;

    const connectedNodeIds = new Set<string>();
    connectedNodeIds.add(nodeId);

    // Find connected edges
    const edges = this.svg.querySelectorAll('.lineage-edges path');
    edges.forEach((edge) => {
      const from = edge.getAttribute('data-from');
      const to = edge.getAttribute('data-to');
      const isConnected = from === nodeId || to === nodeId;

      if (isConnected) {
        if (from) connectedNodeIds.add(from);
        if (to) connectedNodeIds.add(to);
      }

      if (highlight) {
        if (isConnected) {
          edge.setAttribute('stroke', '#4f46e5');
          edge.setAttribute('stroke-opacity', '0.9');
          edge.setAttribute('stroke-width', '2.5');
          edge.setAttribute('filter', 'url(#edgeGlow)');
        } else {
          edge.setAttribute('stroke', '#e5e7eb');
          edge.setAttribute('stroke-opacity', '0.5');
          edge.setAttribute('stroke-width', '1');
          edge.removeAttribute('filter');
        }
      } else {
        const edgeType = edge.getAttribute('data-edge-type') || '';
        edge.setAttribute('stroke', EDGE_COLORS[edgeType] || '#cbd5e1');
        edge.setAttribute('stroke-opacity', '0.36');
        edge.setAttribute('stroke-width', '1.5');
        edge.removeAttribute('filter');
      }
    });

    // Fade/unfade nodes
    const nodes = this.svg.querySelectorAll('.lineage-node');
    nodes.forEach((node) => {
      const nid = node.getAttribute('data-node-id');
      if (highlight) {
        if (nid && connectedNodeIds.has(nid)) {
          (node as SVGGElement).style.opacity = '1';
        } else {
          (node as SVGGElement).style.opacity = '0.3';
        }
      } else {
        (node as SVGGElement).style.opacity = '1';
      }
    });
  }

  private truncateText(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen - 1) + '\u2026';
  }

  private computeFitCompensation(totalW: number, totalH: number): number {
    void totalW;
    void totalH;
    return 1;
  }

  private drawLegend(group: SVGGElement, totalH: number): void {
    const legendGroup = document.createElementNS(SVG_NS, 'g');
    const baseX = PADDING;
    const baseY = totalH - 24;

    const items = [
      { label: 'Static', color: '#94a3b8', dashed: false },
      { label: 'Field Param', color: '#8e24aa', dashed: true },
    ];

    items.forEach((item, idx) => {
      const x = baseX + idx * 140;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', String(x));
      line.setAttribute('y1', String(baseY));
      line.setAttribute('x2', String(x + 20));
      line.setAttribute('y2', String(baseY));
      line.setAttribute('stroke', item.color);
      line.setAttribute('stroke-width', '1.8');
      if (item.dashed) {
        line.setAttribute('stroke-dasharray', '5 4');
      }
      legendGroup.appendChild(line);

      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', String(x + 24));
      text.setAttribute('y', String(baseY + 3));
      text.setAttribute('font-size', '10');
      text.setAttribute('fill', '#64748b');
      text.textContent = item.label;
      legendGroup.appendChild(text);
    });

    group.appendChild(legendGroup);
  }
}
