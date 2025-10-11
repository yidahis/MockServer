import os
import json
from flask import Flask, request, Response, send_from_directory
from flask_cors import CORS
import requests
from datetime import datetime

app = Flask(__name__)
CORS(app)  # 添加CORS支持

MOCKED_DIR = os.path.join(os.path.dirname(__file__), 'mocked')
LOGS_DIR = os.path.join(os.path.dirname(__file__), 'logs')

def match_json_response(url, body):
    # 获取所有文件夹
    folders = [f for f in os.listdir(MOCKED_DIR) if os.path.isdir(os.path.join(MOCKED_DIR, f))]
    # 匹配 URL
    matched_folder = next((folder for folder in folders if folder in url.replace('/', ':')), None)
    if matched_folder and isinstance(body, dict):
        folder_path = os.path.join(MOCKED_DIR, matched_folder)
        json_files = [f for f in os.listdir(folder_path) if f.endswith('.json')]
        body_str = json.dumps(body)
        for file in json_files:
            file_name = os.path.splitext(file)[0]
            if file_name in body_str:
                with open(os.path.join(folder_path, file), 'r', encoding='utf-8') as f:
                    return f.read()
    return None

def get_log_files():
    """获取日志目录中的所有文件列表"""
    try:
        if os.path.exists(LOGS_DIR):
            files = [f for f in os.listdir(LOGS_DIR) if f.endswith('.json')]
            return files
        return []
    except Exception as e:
        print(f"获取日志文件列表失败: {e}")
        return []

def get_newer_log_files(latest_file_name):
    """获取比指定文件更新的所有日志文件"""
    try:
        if not os.path.exists(LOGS_DIR):
            return []
        
        # 获取所有日志文件
        files = [f for f in os.listdir(LOGS_DIR) if f.endswith('.json')]
        
        # 如果没有提供latest_file_name，则返回所有文件
        if not latest_file_name:
            return files
        
        # 从文件名中提取时间戳
        try:
            latest_timestamp = int(latest_file_name.split('_')[0])
        except (ValueError, IndexError):
            # 如果无法解析时间戳，则返回所有文件
            return files
        
        # 筛选出时间戳更新的文件
        newer_files = []
        for file in files:
            try:
                file_timestamp = int(file.split('_')[0])
                if file_timestamp > latest_timestamp:
                    newer_files.append(file)
            except (ValueError, IndexError):
                # 跳过无法解析时间戳的文件
                continue
        
        return newer_files
    except Exception as e:
        print(f"获取新日志文件列表失败: {e}")
        return []

@app.route('/api/logs/files', methods=['GET'])
def get_logs_files():
    """提供日志文件列表的API端点"""
    try:
        # 检查是否有latest参数
        latest_file_name = request.args.get('latest')
        
        if latest_file_name:
            # 获取比指定文件更新的所有日志文件
            files = get_newer_log_files(latest_file_name)
        else:
            # 获取所有日志文件
            files = get_log_files()
        
        # 按时间戳排序（最新的在前面）
        files.sort(key=lambda x: int(x.split('_')[0]), reverse=True)
        
        response = Response(json.dumps(files), mimetype='application/json')
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response
    except Exception as e:
        response = Response(json.dumps({'error': str(e)}), status=500, mimetype='application/json')
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response

@app.route('/logs/<path:filename>', methods=['GET'])
def get_log_file(filename):
    """提供单个日志文件内容的API端点"""
    try:
        # 检查文件是否存在
        file_path = os.path.join(LOGS_DIR, filename)
        if not os.path.exists(file_path):
            response = Response(json.dumps({'error': '文件不存在'}), status=404, mimetype='application/json')
            response.headers.add('Access-Control-Allow-Origin', '*')
            return response
        
        # 返回文件内容
        with open(file_path, 'r', encoding='utf-8') as f:
            content = json.load(f)
            response = Response(json.dumps(content), mimetype='application/json')
            response.headers.add('Access-Control-Allow-Origin', '*')
            return response
    except Exception as e:
        response = Response(json.dumps({'error': str(e)}), status=500, mimetype='application/json')
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response

@app.route('/', defaults={'path': ''}, methods=['GET', 'POST'])
@app.route('/<path:path>', methods=['GET', 'POST'])
def handle_request(path):
    import time
    from datetime import datetime
    import hashlib
    log_dir = os.path.join(os.path.dirname(__file__), 'logs')
    if not os.path.exists(log_dir):
        os.makedirs(log_dir)
    start_time = time.time()
    def safe_log_path(name):
        h = hashlib.md5(name.encode('utf-8')).hexdigest()
        ts = int(time.time()*1000)
        return os.path.join(log_dir, f"{ts}_{h}.json")
    body = request.get_json(silent=True) or {}
    full_url = request.url
    req_info = {
        'timestamp': datetime.now().isoformat(),
        'method': request.method,
        'full-url': full_url,
        'headers': dict(request.headers),
        'body': body
    }
    url = request.path
    body = request.get_json(silent=True) or {}
    # 1. 本地 JSON 匹配
    json_content = match_json_response(url, body)
    if json_content:
        resp_headers = {'Content-Type': 'application/json'}
        resp_info = {
            'status_code': 200,
            'headers': resp_headers,
            'body': json_content
        }
        req_info['cost'] = round(time.time() - start_time, 4)
        req_info['response'] = resp_info
        # 保存日志
        import hashlib
        def safe_log_path(name):
            # 用 hash+时间戳保证唯一且安全
            h = hashlib.md5(name.encode('utf-8')).hexdigest()
            ts = int(time.time()*1000)
            return os.path.join(log_dir, f"{ts}_{h}.json")
        log_path = safe_log_path(url)
        try:
            print(f"[LOG] Writing to {log_path}")
            with open(log_path, 'w', encoding='utf-8') as f:
                json.dump(req_info, f, ensure_ascii=False, indent=2)
            print(f"[LOG] Write success: {log_path}")
        except Exception as log_err:
            print(f"[LOG] Write failed: {log_path}, error: {log_err}")
            # fallback 日志
            fallback_path = os.path.join(log_dir, f"fallback_{int(time.time()*1000)}.json")
            with open(fallback_path, 'w', encoding='utf-8') as f:
                json.dump({'error': str(log_err), 'data': req_info}, f, ensure_ascii=False, indent=2)
        response = Response(json_content, mimetype='application/json')
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response
    # 2. 未命中则转发
    target_url = request.headers.get("origin-host")
    if not target_url:
        response = Response("缺少 origin-host header，无法转发", status=400)
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response

    print('开始转发')
    print(target_url)
    try:
        resp = requests.request(
            method=request.method,
            url=target_url,
            headers={k: v for k, v in request.headers.items() if k.lower() != 'host'},
            json=body if request.method == 'POST' else None
        )
        safe_headers = {k: v for k, v in resp.headers.items() if k.lower() not in ['content-length', 'transfer-encoding', 'connection', 'content-encoding']}
        resp_info = {
            'url': target_url,
            'status_code': resp.status_code,
            'headers': safe_headers,
            'body': resp.content.decode('utf-8', errors='replace')
        }
        req_info['cost'] = round(time.time() - start_time, 4)
        req_info['response'] = resp_info
        # 保存日志
        log_path = safe_log_path(target_url or url)
        try:
            print(f"[LOG] Writing to {log_path}")
            with open(log_path, 'w', encoding='utf-8') as f:
                json.dump(req_info, f, ensure_ascii=False, indent=2)
            print(f"[LOG] Write success: {log_path}")
        except Exception as log_err:
            print(f"[LOG] Write failed: {log_path}, error: {log_err}")
            fallback_path = os.path.join(log_dir, f"fallback_{int(time.time()*1000)}.json")
            with open(fallback_path, 'w', encoding='utf-8') as f:
                json.dump({'error': str(log_err), 'data': req_info}, f, ensure_ascii=False, indent=2)
        response = Response(resp.content, status=resp.status_code, headers=safe_headers)
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response
    except Exception as e:
        resp_info = {
            'status_code': 500,
            'headers': {},
            'body': str(e)
        }
        req_info['cost'] = round(time.time() - start_time, 4)
        req_info['response'] = resp_info
        log_path = safe_log_path(target_url or url)
        try:
            print(f"[LOG] Writing to {log_path}")
            with open(log_path, 'w', encoding='utf-8') as f:
                json.dump(req_info, f, ensure_ascii=False, indent=2)
            print(f"[LOG] Write success: {log_path}")
        except Exception as log_err:
            print(f"[LOG] Write failed: {log_path}, error: {log_err}")
            fallback_path = os.path.join(log_dir, f"fallback_{int(time.time()*1000)}.json")
            with open(fallback_path, 'w', encoding='utf-8') as f:
                json.dump({'error': str(log_err), 'data': req_info}, f, ensure_ascii=False, indent=2)
        response = Response(f"转发失败: {str(e)}", status=500)
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response

if __name__ == '__main__':
    app.run(port=3000)