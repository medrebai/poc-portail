import { Component } from '@angular/core';
import { Input } from '@angular/core';
import { NgStyle } from '@angular/common';
import { MatCardModule } from '@angular/material/card';

interface ChartItem {
  label: string;
  value: number;
  tooltip?: string;
}

@Component({
  selector: 'app-chart-card',
  imports: [MatCardModule, NgStyle],
  templateUrl: './chart-card.component.html',
  styleUrl: './chart-card.component.scss'
})
export class ChartCardComponent {
  @Input() title = '';
  @Input() items: ChartItem[] = [];

  get maxValue(): number {
    return this.items.reduce((max, item) => Math.max(max, item.value), 1);
  }

}
