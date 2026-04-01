from datetime import datetime, timezone
from app import db


class Project(db.Model):
    __tablename__ = 'projects'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    status = db.Column(db.String(50), default='pending')
    error_message = db.Column(db.Text)
    table_count = db.Column(db.Integer)
    measure_count = db.Column(db.Integer)
    column_count = db.Column(db.Integer)
    relationship_count = db.Column(db.Integer)
    data_source_count = db.Column(db.Integer)
    visual_count = db.Column(db.Integer)

    # Relationships
    bpa_violations = db.relationship('BpaViolation', backref='project', cascade='all, delete-orphan')
    bpa_summary = db.relationship('BpaSummary', backref='project', cascade='all, delete-orphan')
    inspector_results = db.relationship('InspectorResult', backref='project', cascade='all, delete-orphan')
    tables = db.relationship('ModelTable', backref='project', cascade='all, delete-orphan')
    columns = db.relationship('ModelColumn', backref='project', cascade='all, delete-orphan')
    measures = db.relationship('ModelMeasure', backref='project', cascade='all, delete-orphan')
    relationships = db.relationship('ModelRelationship', backref='project', cascade='all, delete-orphan')
    roles = db.relationship('ModelRole', backref='project', cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'status': self.status,
            'error_message': self.error_message,
            'table_count': self.table_count,
            'measure_count': self.measure_count,
            'column_count': self.column_count,
            'relationship_count': self.relationship_count,
            'data_source_count': self.data_source_count,
            'visual_count': self.visual_count,
        }
