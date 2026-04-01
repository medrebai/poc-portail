import { Component } from '@angular/core';
import { Input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';

@Component({
  selector: 'app-filter-panel',
  imports: [MatCardModule],
  templateUrl: './filter-panel.component.html',
  styleUrl: './filter-panel.component.scss'
})
export class FilterPanelComponent {
  @Input() title = 'Filters';

}
