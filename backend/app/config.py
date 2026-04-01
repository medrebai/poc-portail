import os
from dotenv import load_dotenv

load_dotenv()


def _parse_size(value: str, default: int) -> int:
    if not value:
        return default
    raw = value.strip().upper()
    if raw.endswith("MB"):
        return int(raw[:-2].strip()) * 1024 * 1024
    if raw.endswith("KB"):
        return int(raw[:-2].strip()) * 1024
    if raw.endswith("GB"):
        return int(raw[:-2].strip()) * 1024 * 1024 * 1024
    return int(raw)


class Config:
    BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    SQLALCHEMY_DATABASE_URI = os.getenv('DATABASE_URL', 'postgresql+psycopg://postgres:postgres@localhost:5432/bi_quality')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    MONGODB_URI = os.getenv('MONGODB_URI', 'mongodb://localhost:27017/bi_quality')
    TABULAR_EDITOR_PATH = os.getenv('TABULAR_EDITOR_PATH', r'C:\Program Files (x86)\Tabular Editor\TabularEditor.exe')
    PBI_INSPECTOR_PATH = os.getenv('PBI_INSPECTOR_PATH', r'C:\Tools\win-x64\CLI\PBIRInspectorCLI.exe')
    BPA_RULES_PATH = os.path.abspath(os.getenv('BPA_RULES_PATH', os.path.join(BASE_DIR, 'rules', 'BPARules-Custom.json')))
    BPA_FIX_TEMPLATES_PATH = os.path.abspath(os.getenv('BPA_FIX_TEMPLATES_PATH', os.path.join(BASE_DIR, 'rules', 'BPAFixTemplates.json')))
    PBI_INSPECTOR_RULES_PATH = os.path.abspath(os.getenv('PBI_INSPECTOR_RULES_PATH', os.path.join(BASE_DIR, 'rules', 'pbi-inspector-rules.json')))
    UPLOAD_FOLDER = os.path.abspath(os.getenv('UPLOAD_FOLDER', os.path.join(BASE_DIR, 'uploads')))
    MAX_CONTENT_LENGTH = _parse_size(os.getenv('MAX_UPLOAD_SIZE', '104857600'), 104857600)
