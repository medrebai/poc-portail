from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_cors import CORS

from .config import Config

db = SQLAlchemy()
migrate = Migrate()


def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)

    db.init_app(app)
    migrate.init_app(app, db)
    CORS(app)

    from .routes.projects import projects_bp
    from .routes.catalog import catalog_bp
    from .routes.bpa import bpa_bp
    from .routes.inspector import inspector_bp
    from .routes.export import export_bp

    app.register_blueprint(projects_bp, url_prefix='/api/projects')
    app.register_blueprint(catalog_bp, url_prefix='/api/projects')
    app.register_blueprint(bpa_bp, url_prefix='/api/projects')
    app.register_blueprint(inspector_bp, url_prefix='/api/projects')
    app.register_blueprint(export_bp, url_prefix='/api/projects')

    return app
