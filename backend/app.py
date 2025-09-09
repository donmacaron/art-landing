from flask import Flask, jsonify, send_from_directory
from pathlib import Path

app = Flask(__name__)

@app.route('/api/hello')
def hello():
    return jsonify({"msg": "Hello from Flask!"})

# Production: отдаём собранный фронтенд (vite build -> frontend/dist)
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    dist_dir = Path(__file__).resolve().parent.parent / 'frontend' / 'dist'
    # если файл существует — отдать его, иначе — index.html (SPA)
    if path != "" and (dist_dir / path).exists():
        return send_from_directory(str(dist_dir), path)
    else:
        return send_from_directory(str(dist_dir), 'index.html')

if __name__ == '__main__':
    # debug=True — для разработки (в WSL лучше запускать из терминала)
    app.run(host='0.0.0.0', port=5000, debug=True)
