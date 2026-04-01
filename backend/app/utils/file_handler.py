import os
import zipfile
import shutil
import time
from flask import current_app


def get_upload_path(project_id):
    base = os.path.abspath(current_app.config['UPLOAD_FOLDER'])
    return os.path.join(base, str(project_id))


def extract_zip(zip_file, project_id):
    upload_path = get_upload_path(project_id)
    os.makedirs(upload_path, exist_ok=True)

    with zipfile.ZipFile(zip_file, 'r') as zf:
        zf.extractall(upload_path)

    return upload_path


def save_uploaded_folder(files, relative_paths, project_id):
    """Save uploaded folder files to project upload directory preserving structure."""
    upload_path = get_upload_path(project_id)
    os.makedirs(upload_path, exist_ok=True)

    for file_storage, rel_path in zip(files, relative_paths):
        if not rel_path:
            continue

        normalized = rel_path.replace('\\', '/')
        if normalized.startswith('/') or '..' in normalized.split('/'):
            raise ValueError(f'Unsafe relative path: {rel_path}')

        target_path = os.path.join(upload_path, *normalized.split('/'))
        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        file_storage.save(target_path)

    return upload_path


def validate_pbip_structure(upload_path):
    """Validate that the extracted ZIP contains required PBIP structure."""
    semantic_model_dir = None
    report_dir = None

    # Walk one or two levels to find the .SemanticModel and .Report folders
    for root, dirs, files in os.walk(upload_path):
        depth = root.replace(upload_path, '').count(os.sep)
        if depth > 2:
            continue
        for d in dirs:
            if d.endswith('.SemanticModel'):
                semantic_model_dir = os.path.join(root, d)
            elif d.endswith('.Report'):
                report_dir = os.path.join(root, d)

    errors = []

    if not semantic_model_dir:
        errors.append('Missing .SemanticModel folder')
    else:
        definition_dir = os.path.join(semantic_model_dir, 'definition')
        if not os.path.isdir(definition_dir):
            errors.append('Missing definition/ folder inside .SemanticModel')
        else:
            tables_dir = os.path.join(definition_dir, 'tables')
            if not os.path.isdir(tables_dir):
                errors.append('Missing tables/ folder inside definition/')

    if not report_dir:
        errors.append('Missing .Report folder')

    return {
        'valid': len(errors) == 0,
        'errors': errors,
        'semantic_model_dir': semantic_model_dir,
        'report_dir': report_dir,
    }


def cleanup_upload(project_id):
    upload_path = get_upload_path(project_id)
    if os.path.exists(upload_path):
        # Windows tools may keep files locked briefly after analysis subprocess exits.
        for _ in range(6):
            try:
                shutil.rmtree(upload_path)
                return
            except PermissionError:
                time.sleep(0.5)
            except OSError:
                time.sleep(0.3)
