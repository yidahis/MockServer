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
            files.sort()
            return files
        
        # 返回比指定文件更新的文件
        files.sort()
        index = files.index(latest_file_name) if latest_file_name in files else -1
        return files[index + 1:] if index != -1 else files
    except Exception as e:
        print(f"获取新日志文件列表失败: {e}")
        return []

@app.route('/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
def handle_request(path):
    try:
        # 尝试解析请求体为JSON
        try:
            body = request.get_json() if request.is_json else {}
        except:
            body = {}
        
        # 尝试匹配本地JSON响应
        matched_response = match_json_response(request.url, body)
        if matched_response:
            return Response(matched_response, mimetype='application/json')
        
        # 如果没有匹配到本地响应，则转发请求
        origin_host = request.headers.get('origin-host')
        if not origin_host:
            return {'error': 'Missing origin-host header'}, 400
        
        # 构造转发URL
        forward_url = f"{origin_host.rstrip('/')}/{path.lstrip('/')}"
        
        # 记录开始时间
        start_time = datetime.now()
        
        # 转发请求
        headers = {key: value for key, value in request.headers.items() if key.lower() != 'host'}
        
        # 修复请求头中Content-Length和Transfer-Encoding的冲突
        if 'Transfer-Encoding' in headers:
            headers.pop('Content-Length', None)
        elif 'Content-Length' in headers:
            headers.pop('Transfer-Encoding', None)
            
        if request.method == 'GET':
            response = requests.get(forward_url, headers=headers, params=request.args)
        elif request.method == 'POST':
            response = requests.post(forward_url, headers=headers, json=body)
        elif request.method == 'PUT':
            response = requests.put(forward_url, headers=headers, json=body)
        elif request.method == 'DELETE':
            response = requests.delete(forward_url, headers=headers)
        elif request.method == 'PATCH':
            response = requests.patch(forward_url, headers=headers, json=body)
        
        # 计算耗时
        cost = (datetime.now() - start_time).total_seconds()
        
        # 记录日志
        log_data = {
            'timestamp': start_time.isoformat(),
            'method': request.method,
            'full-url': request.url,
            'path': path,
            'headers': dict(request.headers),
            'body': body,
            'response': {
                'status_code': response.status_code,
                'headers': dict(response.headers),
                'body': response.text
            },
            'cost': cost
        }
        
        # 保存日志文件
        if not os.path.exists(LOGS_DIR):
            os.makedirs(LOGS_DIR)
            
        # 生成日志文件名（时间戳+内容hash）
        content_hash = hash(json.dumps({
            'method': request.method,
            'url': request.url,
            'body': body
        }))
        log_filename = f"{int(start_time.timestamp() * 1000)}_{abs(content_hash)}.json"
        log_filepath = os.path.join(LOGS_DIR, log_filename)
        
        with open(log_filepath, 'w', encoding='utf-8') as f:
            json.dump(log_data, f, ensure_ascii=False, indent=2)
        
        # 返回转发的响应
        # 清理可能冲突的头部
        response_headers = dict(response.headers)
        if 'Transfer-Encoding' in response_headers:
            response_headers.pop('Content-Length', None)
        elif 'Content-Length' in response_headers:
            response_headers.pop('Transfer-Encoding', None)
            
        return Response(response.text, status=response.status_code, headers=response_headers)
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

def main():
    """主函数，用于命令行运行"""
    port = int(os.environ.get('PORT', 3000))
    app.run(host='0.0.0.0', port=port, debug=True)

if __name__ == '__main__':
    main()