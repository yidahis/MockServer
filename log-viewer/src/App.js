import React, { useState, useEffect, useRef } from 'react';
import hljs from 'highlight.js';
// 将默认主题更换为atom-one-dark主题
import 'highlight.js/styles/atom-one-dark.css';
// 调整导入顺序，确保自定义样式覆盖主题样式
import './App.css';
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
  const [copySuccess, setCopySuccess] = useState(false); // 添加复制成功状态
  const [filterText, setFilterText] = useState(''); // 添加筛选文本状态
  const [filterType, setFilterType] = useState('URL'); // 添加筛选类型状态，默认为URL
  const [filterHistory, setFilterHistory] = useState([]); // 添加筛选历史记录状态
  const [showHistory, setShowHistory] = useState(false); // 添加显示历史记录状态
  const [showFilterTypeDropdown, setShowFilterTypeDropdown] = useState(false); // 添加显示筛选类型下拉菜单状态
  const [isInteractingWithHistory, setIsInteractingWithHistory] = useState(false); // 添加与历史记录交互状态
  const urlListRef = useRef(null); // 用于监听滚动事件
  const urlListContentRef = useRef(null); // 用于获取内容区域的引用
  const pollIntervalRef = useRef(null); // 轮询定时器引用
  const isInitialLoad = useRef(true); // 标记是否为初始加载
  const selectedLogIdRef = useRef(null); // 使用ref存储选中的日志ID，避免状态更新的影响

  // 获取日志文件列表
  useEffect(() => {
    // 检查是否有保存的筛选历史记录
    const savedFilterHistory = localStorage.getItem('filterHistory');
    if (savedFilterHistory) {
      try {
        setFilterHistory(JSON.parse(savedFilterHistory));
      } catch (e) {
        console.warn('解析筛选历史记录失败:', e);
      }
    }
    
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

  // 添加useEffect来处理点击其他地方隐藏下拉菜单
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showFilterTypeDropdown && !event.target.closest('.search-input-container')) {
        setShowFilterTypeDropdown(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [showFilterTypeDropdown]);

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

  const handleSelectLog = (log, index) => {
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
            theme="monokai"
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
          theme="monokai"
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

  // 新增：生成curl命令
  const generateCurlCommand = (log) => {
    const method = log.method;
    const url = log['full-url'];
    const headers = log.headers;
    const body = log.body;
    
    let curlCommand = `curl -X ${method} "${url}"`;
    
    // 添加headers
    Object.keys(headers).forEach(key => {
      curlCommand += ` -H "${key}: ${headers[key]}"`;
    });
    
    // 添加body
    if (body && typeof body === 'object') {
      curlCommand += ` -H "Content-Type: application/json" -d '${JSON.stringify(body)}'`;
    } else if (body) {
      curlCommand += ` -d '${body}'`;
    }
    
    return curlCommand;
  };

  // 新增：处理curl命令复制
  const handleCopyCurl = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopySuccess(true);
      // 2秒后隐藏toast
      setTimeout(() => {
        setCopySuccess(false);
      }, 2000);
    }).catch(err => {
      console.error('Failed to copy: ', err);
    });
  };

  // 新增：处理筛选文本变化
  const handleFilterChange = (value) => {
    setFilterText(value);
    // 显示历史记录
    setShowHistory(true);
  };

  // 新增：处理筛选完成（回车键或失去焦点时保存历史记录）
  const handleFilterComplete = (value) => {
    if (value) {
      saveFilterToHistory(value);
    }
    // 隐藏历史记录
    setShowHistory(false);
  };

  // 新增：选择历史记录项
  const handleSelectHistory = (historyItem) => {
    // 解析历史记录项，格式为 "筛选类型:筛选文本"
    const parts = historyItem.split(':');
    if (parts.length === 2) {
      const [type, text] = parts;
      setFilterType(type);
      setFilterText(text);
    } else {
      // 兼容旧格式，只包含筛选文本，默认为URL类型
      setFilterType('URL');
      setFilterText(historyItem);
    }
    setShowHistory(false);
  };

  // 新增：保存筛选历史记录
  const saveFilterToHistory = (text) => {
    if (!text) return;
    
    // 创建带筛选类型的记录
    const historyItem = `${filterType}:${text}`;
    
    // 检查是否已存在于历史记录中
    if (filterHistory.includes(historyItem)) {
      // 如果已存在，则将其移到最前面
      const updatedHistory = [historyItem, ...filterHistory.filter(item => item !== historyItem)].slice(0, 10);
      setFilterHistory(updatedHistory);
      localStorage.setItem('filterHistory', JSON.stringify(updatedHistory));
      return;
    }
    
    // 更新历史记录
    const updatedHistory = [historyItem, ...filterHistory].slice(0, 10); // 最多保存10条记录
    setFilterHistory(updatedHistory);
    localStorage.setItem('filterHistory', JSON.stringify(updatedHistory));
  };

  // 新增：删除历史记录项
  const removeFilterFromHistory = (itemToRemove, e) => {
    // 阻止事件冒泡，避免触发选择历史记录
    if (e) {
      e.stopPropagation();
    }
    
    const updatedHistory = filterHistory.filter(item => item !== itemToRemove);
    setFilterHistory(updatedHistory);
    localStorage.setItem('filterHistory', JSON.stringify(updatedHistory));
    
    // 如果删除的是当前筛选文本对应的历史记录，则清空筛选框
    if (itemToRemove === `${filterType}:${filterText}`) {
      setFilterText('');
    }
    
    // 保持历史记录列表显示状态
    setShowHistory(true);
    setIsInteractingWithHistory(true);
    
    // 在一段时间后重置交互状态
    setTimeout(() => {
      setIsInteractingWithHistory(false);
    }, 3000);
  };

  // 新增：处理筛选类型变化
  const handleFilterTypeChange = (type) => {
    setFilterType(type);
    setShowFilterTypeDropdown(false);
  };

  // 新增：根据筛选类型过滤日志
  const filterLogs = (logs, filterText, filterType) => {
    if (!filterText) return logs;
    
    return logs.filter(log => {
      switch (filterType) {
        case 'URL':
          return log['full-url'] && typeof log['full-url'] === 'string' && log['full-url'].includes(filterText);
        case 'Request':
          // 检查请求body是否包含筛选文本
          if (log.body) {
            if (typeof log.body === 'string') {
              return log.body.includes(filterText);
            } else if (typeof log.body === 'object') {
              return JSON.stringify(log.body).includes(filterText);
            }
          }
          return false;
        case 'Response':
          // 检查响应body是否包含筛选文本
          if (log.response && log.response.body) {
            if (typeof log.response.body === 'string') {
              return log.response.body.includes(filterText);
            } else if (typeof log.response.body === 'object') {
              return JSON.stringify(log.response.body).includes(filterText);
            }
          }
          return false;
        default:
          return false;
      }
    });
  };

  if (error) {
    return <div className="App">错误: {error}</div>;
  }

  return (
    <div className="App">
      <header className="App-header">
        <p>
          共有 {logs.length} 条请求日志
          {filterText && ` (筛选出 ${logs.filter(log => log['full-url'] && typeof log['full-url'] === 'string' && log['full-url'].includes(filterText)).length} 条)`}
        </p>
      </header>
      <div className="logs-container">
        {/* 左侧URL列表 */}
        <div className="url-list" ref={urlListRef}>
          <div className="url-list-header" id="url-list-header">
            <h2>请求URL列表</h2>
            <div className="search-container-wrapper">
              <div className="search-container">
                <div className="search-input-container">
                  <input
                    type="text"
                    placeholder={`输入${filterType}关键词进行筛选`}
                    value={filterText}
                    onChange={(e) => handleFilterChange(e.target.value)}
                    onFocus={() => filterHistory.length > 0 && setShowHistory(true)}
                    onBlur={() => {
                      // 延迟隐藏历史记录，确保点击历史记录项时不会立即隐藏
                      setTimeout(() => {
                        if (!isInteractingWithHistory) {
                          setShowHistory(false);
                        }
                      }, 150);
                      // 失去焦点时保存历史记录
                      handleFilterComplete(filterText);
                    }}
                    onKeyDown={(e) => {
                      // 按回车键时保存筛选历史
                      if (e.key === 'Enter') {
                        handleFilterComplete(filterText);
                      }
                    }}
                    className="search-input"
                  />
                  <button 
                    className="filter-type-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowFilterTypeDropdown(!showFilterTypeDropdown);
                    }}
                  >
                    ▼
                  </button>
                </div>
                {showFilterTypeDropdown && (
                  <div 
                    className="filter-type-dropdown"
                    onMouseEnter={() => setIsInteractingWithHistory(true)}
                    onMouseLeave={() => setIsInteractingWithHistory(false)}
                  >
                    <ul>
                      <li onClick={() => handleFilterTypeChange('URL')}>URL</li>
                      <li onClick={() => handleFilterTypeChange('Request')}>Request</li>
                      <li onClick={() => handleFilterTypeChange('Response')}>Response</li>
                    </ul>
                  </div>
                )}
                {showHistory && (
                  <div 
                    className="filter-history"
                    onMouseEnter={() => setIsInteractingWithHistory(true)}
                    onMouseLeave={() => setIsInteractingWithHistory(false)}
                  >
                    <ul>
                      {filterHistory.length > 0 ? (
                        filterHistory
                          .filter((item, index, self) => self.indexOf(item) === index) // 去重
                          .map((historyItem, index) => {
                            // 解析历史记录项，格式为 "筛选类型:筛选文本"
                            const parts = historyItem.split(':');
                            let displayText = historyItem;
                            let type = 'URL';
                            let text = historyItem;
                            if (parts.length === 2) {
                              [type, text] = parts;
                              displayText = `${type}:${text}`;
                            }
                            return (
                              <li 
                                key={index} 
                                onClick={() => handleSelectHistory(historyItem)}
                              >
                                <span className="history-text">{displayText}</span>
                                <span 
                                  className="delete-icon"
                                  onClick={(e) => {
                                    e.stopPropagation(); // 阻止事件冒泡，避免触发选择历史记录
                                    removeFilterFromHistory(historyItem);
                                  }}
                                >
                                  ×
                                </span>
                              </li>
                            );
                          })
                      ) : (
                        <li className="empty-history">暂无历史记录</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            </div>
            <div className="filter-stats">
              {filterText && (
                <p>
                  筛选类型: {filterType} | 筛选结果: {filterLogs(logs, filterText, filterType).length} / {logs.length} 条记录
                </p>
              )}
            </div>
          </div>
          <div className="url-list-content" ref={urlListContentRef}>
            <ul>
              {filterLogs(logs, filterText, filterType)
                .map((log, index) => (
                  <li 
                    key={index} 
                    className={selectedLog && selectedLog.timestamp === log.timestamp ? 'selected' : ''}
                    onClick={() => handleSelectLog(log, index)}
                  >
                    {/* 添加序号显示，基于筛选后的列表 */}
                    <span className="sequence-number">{index + 1}</span>
                    <div className="url">{log['full-url']}</div>
                    <div className="timestamp">{new Date(log.timestamp).toLocaleString()}</div>
                  </li>
                ))}
            </ul>
          </div>
        </div>

        {/* 右侧详情 */}
        <div className="log-details">
          {selectedLog ? (
            <div className="details-container">
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
                    <ReactJson 
                      src={selectedLog.response.headers}
                      name={false}
                      collapsed={false}
                      displayDataTypes={false}
                      displayObjectSize={false}
                      enableClipboard={true}
                      indentWidth={2}
                      theme="monokai"
                      style={{
                        backgroundColor: '#2d2d2d',
                        padding: '1em',
                        borderRadius: '4px',
                        overflow: 'auto'
                      }}
                    />
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
                  <button 
                    className={selectedRequestSegment === 'info' ? 'active' : ''}
                    onClick={() => setSelectedRequestSegment('info')}
                  >
                    Info
                  </button>
                </div>
                <div className="request-content">
                  {selectedRequestSegment === 'body' ? (
                    renderContent(selectedLog.body)
                  ) : selectedRequestSegment === 'headers' ? (
                    <ReactJson 
                      src={selectedLog.headers}
                      name={false}
                      collapsed={false}
                      displayDataTypes={false}
                      displayObjectSize={false}
                      enableClipboard={true}
                      indentWidth={2}
                      theme="monokai"
                      style={{
                        backgroundColor: '#2d2d2d',
                        padding: '1em',
                        borderRadius: '4px',
                        overflow: 'auto'
                      }}
                    />
                  ) : (
                    <div>
                      <p><strong>Method:</strong> {selectedLog.method}</p>
                      <p><strong>URL:</strong> {selectedLog['full-url']}</p>
                      <p><strong>Timestamp:</strong> {new Date(selectedLog.timestamp).toLocaleString()}</p>
                      <p><strong>Curl Command:</strong></p>
                      <pre 
                        onClick={() => handleCopyCurl(generateCurlCommand(selectedLog))}
                        style={{ cursor: 'pointer', padding: '10px', backgroundColor: '#2d2d2d', border: '1px solid #3b3b3b', borderRadius: '4px' }}
                      >
                        {generateCurlCommand(selectedLog)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p>请选择一个请求查看详细信息</p>
          )}
        </div>
      </div>
      {/* 添加复制成功提示 */}
      {copySuccess && (
        <div className="toast">
          Curl命令已复制到剪贴板
        </div>
      )}
    </div>
  );
}

export default App;