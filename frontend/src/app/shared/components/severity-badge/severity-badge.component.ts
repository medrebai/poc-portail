import { Component } from '@angular/core';
import { Input } from '@angular/core';
import { NgClass } from '@angular/common';

@Component({
  selector: 'app-severity-badge',
  imports: [NgClass],
  templateUrl: './severity-badge.component.html',
  styleUrl: './severity-badge.component.scss'
})
export class SeverityBadgeComponent {
  @Input() label = 'Info';
  @Input() tone: 'error' | 'warning' | 'info' | 'success' = 'info';

}
