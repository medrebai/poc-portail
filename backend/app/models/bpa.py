from app import db


class BpaViolation(db.Model):
    __tablename__ = 'bpa_violations'

    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False)
    rule_id = db.Column(db.String(100), nullable=False)
    rule_name = db.Column(db.String(255))
    category = db.Column(db.String(100))
    severity = db.Column(db.Integer)
    severity_label = db.Column(db.String(20))
    object_type = db.Column(db.String(50))
    object_name = db.Column(db.String(255))
    table_name = db.Column(db.String(255))
    description = db.Column(db.Text)
    fix_template = db.Column(db.Text)
    fix_steps = db.Column(db.JSON)

    def to_dict(self):
        return {
            'id': self.id,
            'project_id': self.project_id,
            'rule_id': self.rule_id,
            'rule_name': self.rule_name,
            'category': self.category,
            'severity': self.severity,
            'severity_label': self.severity_label,
            'object_type': self.object_type,
            'object_name': self.object_name,
            'table_name': self.table_name,
            'description': self.description,
            'fix_template': self.fix_template,
            'fix_steps': self.fix_steps,
        }


class BpaSummary(db.Model):
    __tablename__ = 'bpa_summary'

    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False)
    rule_id = db.Column(db.String(100))
    rule_name = db.Column(db.String(255))
    category = db.Column(db.String(100))
    severity = db.Column(db.Integer)
    severity_label = db.Column(db.String(20))
    count = db.Column(db.Integer)

    def to_dict(self):
        return {
            'id': self.id,
            'project_id': self.project_id,
            'rule_id': self.rule_id,
            'rule_name': self.rule_name,
            'category': self.category,
            'severity': self.severity,
            'severity_label': self.severity_label,
            'count': self.count,
        }
