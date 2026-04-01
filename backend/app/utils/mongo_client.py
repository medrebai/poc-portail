from pymongo import MongoClient
from flask import current_app

_client = None
_db = None


def get_mongo_db():
    global _client, _db
    if _db is None:
        uri = current_app.config['MONGODB_URI']
        _client = MongoClient(uri)
        db_name = uri.rsplit('/', 1)[-1]
        _db = _client[db_name]
    return _db


def store_raw_result(project_id, result_type, data):
    db = get_mongo_db()
    from datetime import datetime, timezone
    db.raw_results.insert_one({
        'project_id': project_id,
        'type': result_type,
        'data': data,
        'created_at': datetime.now(timezone.utc),
    })


def get_raw_result(project_id, result_type):
    db = get_mongo_db()
    doc = db.raw_results.find_one(
        {'project_id': project_id, 'type': result_type},
        sort=[('created_at', -1)]
    )
    return doc['data'] if doc else None


def delete_project_results(project_id):
    db = get_mongo_db()
    db.raw_results.delete_many({'project_id': project_id})
