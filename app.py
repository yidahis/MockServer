import os
import json
from flask import Flask, request, Response, send_from_directory
from flask_cors import CORS
import requests
from datetime import datetime
import time
import hashlib
from datetime import datetime

app = Flask(__name__)
CORS(app)  # 添加CORS支持

MOCKED_DIR = os.path.join(os.path.dirname(__file__), 'mocked')
LOGS_DIR = os.path.join(os.path.dirname(__file__), 'logs')


def match_json_response(url, body):
    # 新规则：遍历mocked目录下所有json文件，判断其内容中的full-url字段是否与url相等
    json_files = [f for f in os.listdir(MOCKED_DIR) if f.endswith('.json')]
    for file in json_files:
        file_path = os.path.join(MOCKED_DIR, file)
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            # 判断json内容中的full-url字段是否与url相等
            if isinstance(data, dict) and data.get('full-url') == url:
                # 只返回json文件中response下的body部分
                response_body = None
                if isinstance(data.get('response'), dict):
                    response_body = data['response'].get('body', None)
                return json.dumps(response_body, ensure_ascii=False)
        except Exception as e:
            continue   
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
            files.sort()
            return files
        
        # 返回比指定文件更新的文件
        files.sort()
        index = files.index(latest_file_name) if latest_file_name in files else -1
        return files[index + 1:] if index != -1 else files
    except Exception as e:
        print(f"获取新日志文件列表失败: {e}")
        return []


@app.route('/api/logs/is_mocked', methods=['POST'])
def is_mocked():
    data = request.get_json()
    full_url = data.get('full-url') if data else None
    if not full_url:
        return {'error': 'Missing full-url parameter'}, 400
    json_files = [f for f in os.listdir(MOCKED_DIR) if f.endswith('.json')]
    for file in json_files:
        file_path = os.path.join(MOCKED_DIR, file)
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = json.load(f)
            if isinstance(content, dict) and content.get('full-url') == full_url:
                return {'mocked': True}
        except Exception:
            continue
    return {'mocked': False}


@app.route('/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
def handle_request(path):
    try:
        # 尝试解析请求体为JSON
        try:
            body = request.get_json() if request.is_json else {}
        except:
            body = {}
        
        # 如果没有匹配到本地响应，则转发请求
        origin_host = request.headers.get('origin-host')
        if not origin_host:
            return {'error': 'Missing origin-host header'}, 400
        
         # 尝试匹配本地JSON响应
        matched_response = match_json_response(origin_host, body)
        if matched_response:
            return Response(matched_response, mimetype='application/json')
        
        
    # 记录开始时间（使用 time.time() 浮点数，便于后续计算）
        start_time = time.time()

        full_url = origin_host
        # 新增：keyword 字段逻辑
        keyword = None
        try:
            with open(os.path.join(os.path.dirname(__file__), 'keywordsForRequeson.json'), 'r', encoding='utf-8') as kf:
                keywords_map = json.load(kf)
            # keywords_map 可能是 list 或 dict
            if isinstance(keywords_map, list):
                # 转为 dict
                temp_map = {}
                for item in keywords_map:
                    temp_map.update(item)
                keywords_map = temp_map
            # 查找 path 对应的 key
            if path in keywords_map:
                key_to_find = keywords_map[path]
                if isinstance(body, dict) and key_to_find in body:
                    keyword =  key_to_find + ": " + body[key_to_find]
        except Exception as e:
            print(f"[LOG] keyword parse error: {e}")

        req_info = {
            'timestamp': datetime.now().isoformat(),
            'method': request.method,
            'full-url': full_url,
            'headers': dict(request.headers),
            'body': body,
            'keyword': keyword
        }
        
        # 转发请求
        target_url = request.headers.get("origin-host")
        resp = requests.request(
            method=request.method,
            url=target_url,
            headers={k: v for k, v in request.headers.items() if k.lower() != 'host'},
            json=body if request.method == 'POST' else None
        )
        safe_headers = {k: v for k, v in resp.headers.items() if k.lower() not in ['content-length', 'transfer-encoding', 'connection', 'content-encoding']}
        # 尝试将resp.content解码为json
        try:
            body_json = resp.json()
        except Exception:
            body_json = resp.content.decode('utf-8', errors='replace')
        resp_info = {
            'url': target_url,
            'status_code': resp.status_code,
            'headers': safe_headers,
            'body': body_json
        }

        log_dir = os.path.join(os.path.dirname(__file__), 'logs')
        def safe_log_path(name):
            h = hashlib.md5(name.encode('utf-8')).hexdigest()
            ts = int(time.time()*1000)
            return os.path.join(log_dir, f"{ts}_{h}.json")
        
        req_info['cost'] = round(time.time() - start_time, 4)
        req_info['response'] = resp_info
        # 保存日志
        log_path = safe_log_path(target_url)
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
        return {'error': str(e)}, 500


@app.route('/api/logs/files')
def get_log_files_api():
    latest = request.args.get('latest')
    if latest:
        files = get_newer_log_files(latest)
    else:
        files = get_log_files()
    return {'files': files}


@app.route('/logs/<filename>')
def get_log_file(filename):
    if not os.path.exists(LOGS_DIR):
        return {'error': 'Logs directory not found'}, 404
    
    try:
        return send_from_directory(LOGS_DIR, filename)
    except Exception as e:
        return {'error': str(e)}, 404


# 新增：删除 logs 目录下所有日志文件的接口
@app.route('/api/logs/delete_all', methods=['POST'])
def delete_all_logs():
    if not os.path.exists(LOGS_DIR):
        return {'error': 'Logs directory not found'}, 404
    try:
        deleted_files = []
        for f in os.listdir(LOGS_DIR):
            file_path = os.path.join(LOGS_DIR, f)
            if os.path.isfile(file_path) and f.endswith('.json'):
                os.remove(file_path)
                deleted_files.append(f)
        return {'deleted': deleted_files, 'count': len(deleted_files)}
    except Exception as e:
        return {'error': str(e)}, 500


# 新增：移动日志文件到 mocked 目录
@app.route('/api/logs/move_to_mocked', methods=['POST'])
def move_log_to_mocked():
    data = request.get_json()
    filename = data.get('fileName') if data else None
    if not filename:
        return {'error': 'Missing filename parameter'}, 400
    src_path = os.path.join(LOGS_DIR, filename)
    dst_path = os.path.join(MOCKED_DIR, filename)
    if not os.path.exists(src_path):
        return {'error': 'Source log file not found'}, 404
    try:
        os.rename(src_path, dst_path)
        return {'success': True, 'moved': filename}
    except Exception as e:
        return {'error': str(e)}, 500


# 新增：取消mock，移动文件从mocked回logs
@app.route('/api/logs/move_to_logs', methods=['POST'])
def move_log_to_logs():
    data = request.get_json()
    filename = data.get('fileName') if data else None
    if not filename:
        return {'error': 'Missing filename parameter'}, 400
    src_path = os.path.join(MOCKED_DIR, filename)
    dst_path = os.path.join(LOGS_DIR, filename)
    if not os.path.exists(src_path):
        return {'error': 'Source mocked file not found'}, 404
    try:
        os.rename(src_path, dst_path)
        return {'success': True, 'moved': filename}
    except Exception as e:
        return {'error': str(e)}, 500


def main():
    """主函数，用于命令行运行"""
    port = int(os.environ.get('PORT', 3000))
    app.run(host='0.0.0.0', port=port, debug=True)


if __name__ == '__main__':
    main()