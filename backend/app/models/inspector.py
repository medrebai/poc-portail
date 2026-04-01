from app import db


class InspectorResult(db.Model):
    __tablename__ = 'inspector_results'

    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False)
    rule_id = db.Column(db.String(100))
    rule_name = db.Column(db.String(255))
    rule_description = db.Column(db.Text)
    page_name = db.Column(db.String(255))
    passed = db.Column(db.Boolean)
    expected = db.Column(db.JSON)
    actual = db.Column(db.JSON)

    def to_dict(self):
        return {
            'id': self.id,
            'project_id': self.project_id,
            'rule_id': self.rule_id,
            'rule_name': self.rule_name,
            'rule_description': self.rule_description,
            'page_name': self.page_name,
            'passed': self.passed,
            'expected': self.expected,
            'actual': self.actual,
        }
