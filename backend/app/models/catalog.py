from app import db


class ModelTable(db.Model):
    __tablename__ = 'model_tables'

    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False)
    name = db.Column(db.String(255))
    is_hidden = db.Column(db.Boolean, default=False)
    mode = db.Column(db.String(50))
    column_count = db.Column(db.Integer)
    measure_count = db.Column(db.Integer)
    partition_count = db.Column(db.Integer)

    columns = db.relationship('ModelColumn', backref='table', cascade='all, delete-orphan')
    measures = db.relationship('ModelMeasure', backref='table', cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id': self.id,
            'project_id': self.project_id,
            'name': self.name,
            'is_hidden': self.is_hidden,
            'mode': self.mode,
            'column_count': self.column_count,
            'measure_count': self.measure_count,
            'partition_count': self.partition_count,
        }


class ModelColumn(db.Model):
    __tablename__ = 'model_columns'

    id = db.Column(db.Integer, primary_key=True)
    table_id = db.Column(db.Integer, db.ForeignKey('model_tables.id', ondelete='CASCADE'))
    project_id = db.Column(db.Integer, db.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False)
    name = db.Column(db.String(255))
    data_type = db.Column(db.String(50))
    is_hidden = db.Column(db.Boolean, default=False)
    format_string = db.Column(db.String(255))
    description = db.Column(db.Text)
    display_folder = db.Column(db.String(255))
    source_column = db.Column(db.String(255))

    def to_dict(self):
        return {
            'id': self.id,
            'table_id': self.table_id,
            'project_id': self.project_id,
            'name': self.name,
            'data_type': self.data_type,
            'is_hidden': self.is_hidden,
            'format_string': self.format_string,
            'description': self.description,
            'display_folder': self.display_folder,
            'source_column': self.source_column,
        }


class ModelMeasure(db.Model):
    __tablename__ = 'model_measures'

    id = db.Column(db.Integer, primary_key=True)
    table_id = db.Column(db.Integer, db.ForeignKey('model_tables.id', ondelete='CASCADE'))
    project_id = db.Column(db.Integer, db.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False)
    name = db.Column(db.String(255))
    expression = db.Column(db.Text)
    format_string = db.Column(db.String(255))
    description = db.Column(db.Text)
    display_folder = db.Column(db.String(255))
    is_hidden = db.Column(db.Boolean, default=False)

    def to_dict(self):
        return {
            'id': self.id,
            'table_id': self.table_id,
            'project_id': self.project_id,
            'name': self.name,
            'expression': self.expression,
            'format_string': self.format_string,
            'description': self.description,
            'display_folder': self.display_folder,
            'is_hidden': self.is_hidden,
        }


class ModelRelationship(db.Model):
    __tablename__ = 'model_relationships'

    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False)
    from_table = db.Column(db.String(255))
    from_column = db.Column(db.String(255))
    to_table = db.Column(db.String(255))
    to_column = db.Column(db.String(255))
    cross_filter = db.Column(db.String(50))
    from_cardinality = db.Column(db.String(20))
    to_cardinality = db.Column(db.String(20))
    is_active = db.Column(db.Boolean, default=True)

    def to_dict(self):
        return {
            'id': self.id,
            'project_id': self.project_id,
            'from_table': self.from_table,
            'from_column': self.from_column,
            'to_table': self.to_table,
            'to_column': self.to_column,
            'cross_filter': self.cross_filter,
            'from_cardinality': self.from_cardinality,
            'to_cardinality': self.to_cardinality,
            'is_active': self.is_active,
        }


class ModelRole(db.Model):
    __tablename__ = 'model_roles'

    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False)
    name = db.Column(db.String(255))
    filters = db.Column(db.JSON)

    def to_dict(self):
        return {
            'id': self.id,
            'project_id': self.project_id,
            'name': self.name,
            'filters': self.filters,
        }
