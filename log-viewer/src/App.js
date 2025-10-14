import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import hljs from 'highlight.js';
import 'highlight.js/styles/default.css';
import { html as formatHtml } from 'js-beautify';
import ReactJson from 'react-json-view';

function App() {
  const [logs, setLogs] = useState([]);
  const [selectedLog, setSelectedLog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [logFileNames, setLogFileNames] = useState([]); // 存储所有日志文件名
  const [isAtBottom, setIsAtBottom] = useState(true); // 标记是否滚动到底部
  const [selectedResponseSegment, setSelectedResponseSegment] = useState('body'); // 添加响应信息的 segment 状态
  const [selectedRequestSegment, setSelectedRequestSegment] = useState('body'); // 添加请求信息的 segment 状态
  const urlListRef = useRef(null); // 用于监听滚动事件
  const pollIntervalRef = useRef(null); // 轮询定时器引用
  const isInitialLoad = useRef(true); // 标记是否为初始加载
  const selectedLogIdRef = useRef(null); // 使用ref存储选中的日志ID，避免状态更新的影响

  // 获取日志文件列表
  useEffect(() => {
    // 检查是否有保存的选中日志ID
    const savedSelectedLogId = localStorage.getItem('selectedLogId');
    if (savedSelectedLogId) {
      selectedLogIdRef.current = savedSelectedLogId;
    }
    
    // 初始获取日志文件列表
    fetchLogFileNames(savedSelectedLogId);
    
    // 设置轮询，每5秒获取一次新增的日志文件列表
    startPolling();
    
    // 清理函数，组件卸载时清除轮询
    return () => {
      stopPolling();
    };
  }, []);

  // 当滚动到底部时重新开始轮询
  useEffect(() => {
    if (isAtBottom) {
      startPolling();
    } else {
      stopPolling();
    }
  }, [isAtBottom]);

  // 保存选中日志ID到localStorage
  useEffect(() => {
    if (selectedLog) {
      localStorage.setItem('selectedLogId', selectedLog.timestamp);
      selectedLogIdRef.current = selectedLog.timestamp;
    }
  }, [selectedLog]);

  // 开始轮询
  const startPolling = () => {
    // 先清除现有的轮询
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
    
    // 设置新的轮询，每5秒获取一次新增的日志文件列表
    pollIntervalRef.current = setInterval(() => {
      fetchLogFileNames();
    }, 5000);
  };

  // 停止轮询
  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  // 滚动到底部
  const scrollToBottom = () => {
    if (urlListRef.current) {
      urlListRef.current.scrollTop = urlListRef.current.scrollHeight;
    }
  };

  // 检查是否滚动到底部
  const checkIfAtBottom = () => {
    if (!urlListRef.current) return;
    
    const { scrollTop, scrollHeight, clientHeight } = urlListRef.current;
    const isBottom = scrollHeight - scrollTop - clientHeight < 10;
    setIsAtBottom(isBottom);
  };

  // 获取日志文件列表
  const fetchLogFileNames = async (savedSelectedLogId = null) => {
    try {
      // 确定最新的文件名（用于获取新增数据）
      let latestFileName = null;
      if (logFileNames.length > 0) {
        // 获取时间戳最大的文件名（最新的）
        latestFileName = logFileNames.reduce((latest, current) => {
          const latestTimestamp = parseInt(latest.split('_')[0]) || 0;
          const currentTimestamp = parseInt(current.split('_')[0]) || 0;
          return currentTimestamp > latestTimestamp ? current : latest;
        }, logFileNames[0]);
      }
      
      // 使用主服务提供的API端点获取日志文件列表
      const url = latestFileName 
        ? `http://localhost:3000/api/logs/files?latest=${encodeURIComponent(latestFileName)}`
        : 'http://localhost:3000/api/logs/files';
      
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        // 修复：处理后端返回的数据格式 {files: [...]} 
        const files = Array.isArray(data) ? data : (data.files || []);
        
        // 如果有新增文件
        if (files.length > 0) {
          // 更新文件名列表
          const updatedFileNames = [...logFileNames, ...files];
          setLogFileNames(updatedFileNames);
          
          // 获取新增文件的内容
          await fetchNewLogs(files, savedSelectedLogId);
        } else if (isInitialLoad.current) {
          // 如果是初始加载且没有文件，则获取所有文件
          const allResponse = await fetch('http://localhost:3000/api/logs/files');
          if (allResponse.ok) {
            const allData = await allResponse.json();
            // 修复：处理后端返回的数据格式 {files: [...]}
            const allFiles = Array.isArray(allData) ? allData : (allData.files || []);
            setLogFileNames(allFiles);
            await fetchNewLogs(allFiles, savedSelectedLogId);
          }
          isInitialLoad.current = false;
        } else {
          // 如果不是初始加载且没有新文件，则停止加载状态
          setLoading(false);
        }
      } else {
        throw new Error(`获取文件列表失败: ${response.status}`);
      }
    } catch (err) {
      console.warn('无法从API获取日志目录列表:', err);
      if (isInitialLoad.current) {
        try {
          // 回退到从本地files.json文件获取
          const localResponse = await fetch('/logs/files.json');
          if (localResponse.ok) {
            const data = await localResponse.json();
            // 如果是对象且包含files字段，则使用files字段
            const files = Array.isArray(data) ? data : (data.files || []);
            setLogFileNames(files);
            await fetchNewLogs(files, savedSelectedLogId);
          }
          isInitialLoad.current = false;
        } catch (localErr) {
          console.warn('无法从本地获取日志目录列表:', localErr);
        }
      }
      setLoading(false);
    }
  };

  // 获取新增日志数据
  const fetchNewLogs = async (newFileNames, savedSelectedLogId = null) => {
    // 修复：确保 newFileNames 是数组
    if (!Array.isArray(newFileNames) || newFileNames.length === 0) {
      setLoading(false);
      return;
    }

    try {
      // 读取新增日志文件的内容
      const logPromises = newFileNames.map(async (fileName) => {
        try {
          // 使用新的API端点获取日志内容
          const response = await fetch(`http://localhost:3000/logs/${fileName}`);
          if (response.ok) {
            const logData = await response.json();
            return logData;
          } else {
            console.warn(`无法从API读取日志文件 ${fileName}: ${response.status}`);
            return null;
          }
        } catch (err) {
          console.warn(`解析日志文件 ${fileName} 失败:`, err);
          return null;
        }
      });
      
      // 等待新增日志文件读取完成
      const newLogs = (await Promise.all(logPromises)).filter(log => log !== null);
      
      // 按时间戳排序（最新的在最后面）
      newLogs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
      // 将新增日志追加到现有日志列表
      const updatedLogs = [...logs, ...newLogs];
      setLogs(updatedLogs);
      
      // 处理选中状态 - 关键修改：使用更严格的逻辑
      if (isInitialLoad.current) {
        // 初始加载时的选中逻辑
        let logToSelect = null;
        
        // 首先尝试使用保存的选中日志ID
        if (savedSelectedLogId) {
          logToSelect = updatedLogs.find(log => log.timestamp === savedSelectedLogId);
        }
        
        // 如果没有保存的选中日志ID或未找到，则使用ref中的ID
        if (!logToSelect && selectedLogIdRef.current) {
          logToSelect = updatedLogs.find(log => log.timestamp === selectedLogIdRef.current);
        }
        
        // 如果还是没有找到，则默认选中最新的日志
        if (!logToSelect && updatedLogs.length > 0) {
          logToSelect = updatedLogs[updatedLogs.length - 1];
        }
        
        if (logToSelect) {
          setSelectedLog(logToSelect);
          // 如果是初始加载且选中了最新日志，则滚动到底部
          if (logToSelect === updatedLogs[updatedLogs.length - 1]) {
            setTimeout(() => scrollToBottom(), 0);
          }
        }
      } else {
        // 轮询更新时的选中逻辑 - 关键修改：严格保持选中状态
        let logToSelect = null;
        
        // 首先尝试使用当前选中的日志
        if (selectedLog) {
          logToSelect = updatedLogs.find(log => log.timestamp === selectedLog.timestamp);
        }
        
        // 如果当前没有选中日志，则使用ref中的ID
        if (!logToSelect && selectedLogIdRef.current) {
          logToSelect = updatedLogs.find(log => log.timestamp === selectedLogIdRef.current);
        }
        
        // 只有在确实找不到之前选中的日志时，才考虑其他选项
        if (logToSelect) {
          // 保持选中状态
          setSelectedLog(logToSelect);
        } else if (!selectedLog) {
          // 只有在完全没有选中任何日志时，才默认选中最新日志
          if (updatedLogs.length > 0) {
            const latestLog = updatedLogs[updatedLogs.length - 1];
            setSelectedLog(latestLog);
            // 如果在底部，则滚动到底部
            if (isAtBottom) {
              setTimeout(() => scrollToBottom(), 0);
            }
          }
        }
        // 注意：如果之前有选中的日志但现在找不到了，我们保持selectedLog状态不变
      }
      
      setLoading(false);
      isInitialLoad.current = false;
    } catch (error) {
      console.error('获取新增日志文件失败:', error);
      setError('获取新增日志文件失败: ' + (error.message || error.toString()));
      setLoading(false);
      isInitialLoad.current = false;
    }
  };

  // 处理滚动事件
  const handleScroll = () => {
    checkIfAtBottom();
  };

  // 添加滚动事件监听器
  useEffect(() => {
    const urlListElement = urlListRef.current;
    if (urlListElement) {
      urlListElement.addEventListener('scroll', handleScroll);
      return () => urlListElement.removeEventListener('scroll', handleScroll);
    }
  }, []);

  const handleSelectLog = (log) => {
    setSelectedLog(log);
  };

  // 检查内容是否为HTML
  const isHtmlContent = (content) => {
    if (typeof content !== 'string') return false;
    const trimmedContent = content.trim();
    return trimmedContent.startsWith('<') && trimmedContent.endsWith('>') && 
           (trimmedContent.includes('<html') || trimmedContent.includes('<!DOCTYPE') || 
            trimmedContent.includes('<div') || trimmedContent.includes('<span') ||
            trimmedContent.includes('<p') || trimmedContent.includes('<body') ||
            trimmedContent.includes('<head') || trimmedContent.includes('<table') ||
            trimmedContent.includes('<ul') || trimmedContent.includes('<ol'));
  };

  // 检查内容是否为JSON字符串
  const isJsonString = (content) => {
    if (typeof content !== 'string') return false;
    try {
      const parsed = JSON.parse(content);
      // 确保它是一个对象或数组，而不是简单的字符串或数字
      return typeof parsed === 'object' && parsed !== null;
    } catch (e) {
      return false;
    }
  };

  // 渲染内容（支持HTML格式化和高亮、JSON高亮显示）
  const renderContent = (content) => {
    // 如果是HTML内容，则进行格式化和高亮处理
    if (isHtmlContent(content)) {
      try {
        // 格式化HTML
        const formattedHtml = formatHtml(content, {
          indent_size: 2,
          wrap_line_length: 80,
          preserve_newlines: true,
          max_preserve_newlines: 2
        });
        
        // 高亮处理
        const highlightedHtml = hljs.highlight(formattedHtml, { language: 'html' }).value;
        return <pre dangerouslySetInnerHTML={{ __html: highlightedHtml }} />;
      } catch (e) {
        // 如果格式化或高亮处理失败，则直接显示原始内容
        console.warn('HTML格式化或高亮处理失败:', e);
        return <pre>{content}</pre>;
      }
    }
    
    // 如果是JSON字符串，则进行解析和高亮显示
    if (isJsonString(content)) {
      try {
        const parsedJson = JSON.parse(content);
        return (
          <ReactJson 
            src={parsedJson}
            name={false}
            collapsed={false}
            displayDataTypes={false}
            displayObjectSize={false}
            enableClipboard={true}
            indentWidth={2}
            theme=" Brewer"
            style={{
              backgroundColor: '#2d2d2d',
              padding: '1em',
              borderRadius: '4px',
              overflow: 'auto'
            }}
          />
        );
      } catch (e) {
        // 如果解析失败，则直接显示原始内容
        console.warn('JSON解析失败:', e);
        return <pre>{content}</pre>;
      }
    }
    
    // 如果是对象或数组，则直接进行高亮显示
    if (typeof content === 'object' && content !== null) {
      return (
        <ReactJson 
          src={content}
          name={false}
          collapsed={false}
          displayDataTypes={false}
          displayObjectSize={false}
          enableClipboard={true}
          indentWidth={2}
          theme=" Brewer"
          style={{
            backgroundColor: '#2d2d2d',
            padding: '1em',
            borderRadius: '4px',
            overflow: 'auto'
          }}
        />
      );
    }
    
    // 其他情况直接显示
    return <pre>{String(content)}</pre>;
  };

  if (error) {
    return <div className="App">错误: {error}</div>;
  }

  return (
    <div className="App">
      <header className="App-header">
        <p>共有 {logFileNames.length} 条请求日志</p>
      </header>
      <div className="logs-container">
        {/* 左侧URL列表 */}
        <div className="url-list" ref={urlListRef}>
          <h2>请求URL列表</h2>
          <ul>
            {logs.map((log, index) => (
              <li 
                key={index} 
                className={selectedLog && selectedLog.timestamp === log.timestamp ? 'selected' : ''}
                onClick={() => handleSelectLog(log)}
              >
                <div className="method">{log.method}</div>
                <div className="url">{log['full-url']}</div>
                <div className="timestamp">{new Date(log.timestamp).toLocaleString()}</div>
              </li>
            ))}
          </ul>
          {loading && <div className="loading">加载中...</div>}
        </div>
        
        {/* 右侧详情 */}
        <div className="log-details">
          {selectedLog ? (
            <>
              <div className="response-section">
                <h2>Response</h2>
                {/* 添加 segment 控制 */}
                <div className="segment-control">
                  <button 
                    className={selectedResponseSegment === 'body' ? 'active' : ''}
                    onClick={() => setSelectedResponseSegment('body')}
                  >
                    Body
                  </button>
                  <button 
                    className={selectedResponseSegment === 'headers' ? 'active' : ''}
                    onClick={() => setSelectedResponseSegment('headers')}
                  >
                    Header
                  </button>
                </div>
                <div className="response-content">
                  {selectedResponseSegment === 'body' ? (
                    renderContent(selectedLog.response.body)
                  ) : (
                    <pre>{JSON.stringify(selectedLog.response.headers, null, 2)}</pre>
                  )}
                </div>
              </div>
              <div className="request-section">
                <h2>Request</h2>
                {/* 添加请求信息的 segment 控制 */}
                <div className="segment-control">
                  <button 
                    className={selectedRequestSegment === 'body' ? 'active' : ''}
                    onClick={() => setSelectedRequestSegment('body')}
                  >
                    Body
                  </button>
                  <button 
                    className={selectedRequestSegment === 'headers' ? 'active' : ''}
                    onClick={() => setSelectedRequestSegment('headers')}
                  >
                    Header
                  </button>
                </div>
                <div className="request-content">
                  {selectedRequestSegment === 'body' ? (
                    renderContent(selectedLog.body)
                  ) : (
                    <pre>{JSON.stringify(selectedLog.headers, null, 2)}</pre>
                  )}
                </div>
              </div>
            </>
          ) : (
            <p>请选择一个请求查看详细信息</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;