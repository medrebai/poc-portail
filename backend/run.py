from app import create_app, db

app = create_app()

with app.app_context():
    from app.models import project, bpa, inspector, catalog  # noqa: F401
    db.create_all()

if __name__ == '__main__':
    app.run(debug=True, port=5000)
