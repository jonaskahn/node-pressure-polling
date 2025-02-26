// event-loop-demo.js
const express = require("express");
const EventEmitter = require("events");

// Create Express app
const app = express();
const server = require('http').createServer(app);

// Simple event emitter to simulate updates
const dataSource = new EventEmitter();
let currentValue = 0;

// Simulate data updates every second
setInterval(() => {
  currentValue++;
  dataSource.emit("update", { value: currentValue, timestamp: Date.now() });
}, 1000);

// Simulate a Redis lookup (takes 5ms)
const simulateRedisLookup = async () => {
  // Use promises instead of blocking the event loop
  return new Promise(resolve => {
    setTimeout(() => {
      resolve({ value: currentValue, timestamp: Date.now() });
    }, 5); // 5ms delay to simulate the database lookup
  });
};

// Middleware to log requests
app.use(async (req, res, next) => {
  const requestId = Date.now() + Math.random().toString(36).substring(2, 9);
  const requestTime = new Date().toISOString();
  console.log(`[${requestTime}] Request received: ${requestId} - ${req.url}`);
  
  // Attach requestId to the request object for later use
  req.requestId = requestId;
  next();
});

// Metrics endpoint
app.get("/metrics", async (req, res) => {
  res.json({
    cpuUsage: process.cpuUsage(),
    activeRequests: server._connections,
    memoryUsage: process.memoryUsage(),
    currentValue,
  });
});

// Polling endpoint
app.get("/poll", async (req, res) => {
  const requestId = req.requestId;
  const data = await simulateRedisLookup();

  // Using a promise for the artificial delay
  await new Promise(resolve => setTimeout(resolve, 20));

  res.json({
    data,
    server_processed_at: new Date().toISOString(),
    request_id: requestId,
  });

  console.log(
    `[${new Date().toISOString()}] Request completed: ${requestId}`,
  );
});

// SSE endpoint
app.get("/sse", async (req, res) => {
  const requestId = req.requestId;
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Send initial data
  const data = await simulateRedisLookup();
  res.write(
    `data: ${JSON.stringify({
      data,
      server_processed_at: new Date().toISOString(),
      request_id: requestId,
    })}\n\n`
  );

  // Listen for updates
  const updateListener = (data) => {
    res.write(
      `data: ${JSON.stringify({
        data,
        server_processed_at: new Date().toISOString(),
        request_id: requestId,
      })}\n\n`
    );
  };

  dataSource.on("update", updateListener);

  // Clean up on client disconnect
  req.on("close", () => {
    dataSource.removeListener("update", updateListener);
    console.log(
      `[${new Date().toISOString()}] SSE connection closed: ${requestId}`,
    );
  });
});

// Serve client test page
app.get("/", (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Event Loop Congestion Demo</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .results { margin-top: 20px; }
        .metrics { margin-top: 20px; padding: 10px; background-color: #f0f0f0; }
        .response-time { font-weight: bold; }
        button { margin: 5px; padding: 8px; }
        
        .scroll-container {
          height: 300px;
          overflow-y: auto;
          border: 1px solid #ccc;
          margin-top: 10px;
        }
        
        .response-table {
          width: 100%;
          border-collapse: collapse;
        }
        
        .response-table th, .response-table td {
          padding: 8px;
          text-align: left;
          border-bottom: 1px solid #ddd;
        }
        
        .response-table th {
          position: sticky;
          top: 0;
          background-color: #f8f8f8;
          z-index: 10;
        }
        
        .response-row-polling {
          background-color: rgba(255, 0, 0, 0.1);
        }
        
        .response-row-sse {
          background-color: rgba(0, 128, 0, 0.1);
        }
        
        .response-time-cell {
          font-weight: bold;
        }
        
        .tabs {
          display: flex;
          margin-bottom: 10px;
        }
        
        .tab-btn {
          padding: 8px 16px;
          background-color: #f0f0f0;
          border: 1px solid #ccc;
          border-radius: 4px 4px 0 0;
          margin-right: 5px;
          cursor: pointer;
        }
        
        .tab-btn.active {
          background-color: #fff;
          border-bottom: 1px solid white;
        }
        
        .time-fast {
          color: green;
        }
        
        .time-medium {
          color: orange;
        }
        
        .time-slow {
          color: red;
        }
        
        /* Metrics styling */
        .metrics-table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 10px;
        }
        
        .metrics-table th, .metrics-table td {
          text-align: left;
          padding: 8px;
          border-bottom: 1px solid #ddd;
        }
        
        .metrics-table th {
          background-color: #f8f8f8;
        }
        
        .metrics-header {
          font-weight: bold;
          font-size: 1.1em;
          margin-top: 15px;
          margin-bottom: 5px;
        }
        
        .metrics-description {
          color: #666;
          font-style: italic;
          font-size: 0.9em;
        }
        
        .metrics-value {
          font-family: monospace;
          font-weight: bold;
        }
      </style>
    </head>
    <body>
      <h1>Node.js Event Loop Congestion Demo</h1>
      
      <div>
        <h2>Test Options</h2>
        <div>
          <button id="start-polling">Start Polling Test</button>
          <button id="start-sse">Start SSE Test</button>
          <button id="stop-test">Stop All Tests</button>
        </div>
        <div>
          <label>Number of concurrent clients: 
            <input type="number" id="client-count" value="100" min="1" max="2000">
          </label>
          <label style="margin-left: 15px;">Polling interval (ms): 
            <input type="number" id="polling-interval" value="300" min="50" max="5000">
          </label>
          <button id="update-clients">Update</button>
        </div>
      </div>
      
      <div class="results">
        <h2>Results</h2>
        <div id="polling-results">
          <h3>Polling Results</h3>
          <p>Requests made: <span id="poll-count">0</span></p>
          <p>Average response time: <span id="poll-avg-time" class="response-time">0ms</span></p>
          <p>Max response time: <span id="poll-max-time" class="response-time">0ms</span></p>
        </div>
        
        <div id="sse-results">
          <h3>SSE Results</h3>
          <p>Updates received: <span id="sse-count">0</span></p>
          <p>Connection count: <span id="sse-connections">0</span></p>
        </div>
        
        <div class="metrics">
          <h3>Server Metrics</h3>
          <div id="formatted-metrics">Loading metrics...</div>
        </div>
      </div>
      
      <div id="visualization">
        <h3>Response Time Visualization</h3>
        <div class="tabs">
          <button class="tab-btn active" data-tab="all">All</button>
          <button class="tab-btn" data-tab="polling">Polling</button>
          <button class="tab-btn" data-tab="sse">SSE</button>
        </div>
        <div class="scroll-container">
          <table class="response-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Response Time</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody id="response-list">
              <!-- Response times will be added here -->
            </tbody>
          </table>
        </div>
      </div>
      
      <script>
        // Global tracking variables
        let pollingIntervals = [];
        let sseConnections = [];
        let pollCount = 0;
        let pollTimes = [];
        let sseCount = 0;
        
        // Metric descriptions
        const metricDescriptions = {
          cpuUsage: {
            title: "CPU Usage",
            description: "Cumulative amount of CPU time used by the Node.js process",
            fields: {
              user: "Time spent executing JavaScript code (microseconds)",
              system: "Time spent in system operations like I/O (microseconds)"
            }
          },
          activeRequests: {
            title: "Active Connections",
            description: "Current number of active HTTP connections to the server"
          },
          memoryUsage: {
            title: "Memory Usage",
            description: "Memory consumption of the Node.js process",
            fields: {
              rss: "Resident Set Size - total memory allocated (bytes)",
              heapTotal: "Total size of allocated JavaScript heap (bytes)",
              heapUsed: "Actually used JavaScript heap memory (bytes)",
              external: "Memory used by C++ objects bound to JavaScript (bytes)",
              arrayBuffers: "Memory used for ArrayBuffers and SharedArrayBuffers (bytes)"
            }
          },
          currentValue: {
            title: "Update Counter",
            description: "Simple counter incremented each second to simulate updates"
          }
        };
        
        // Format bytes to human-readable
        function formatBytes(bytes, decimals = 2) {
          if (bytes === 0) return '0 Bytes';
          
          const k = 1024;
          const dm = decimals < 0 ? 0 : decimals;
          const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
          
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          
          return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
        }
        
        // Format microseconds in a human-readable way
        function formatMicroseconds(microseconds) {
          if (microseconds < 1000) {
            return microseconds + ' μs';
          } else if (microseconds < 1000000) {
            return (microseconds / 1000).toFixed(2) + ' ms';
          } else {
            return (microseconds / 1000000).toFixed(2) + ' s';
          }
        }
        
        // Update metrics with formatted display and descriptions
        function updateMetrics() {
          fetch('/metrics')
            .then(response => response.json())
            .then(data => {
              const metricsContainer = document.getElementById('formatted-metrics');
              let html = '';
              
              // Process each top-level metric
              for (const [key, value] of Object.entries(data)) {
                const metricInfo = metricDescriptions[key] || { title: key, description: "" };
                
                html += \`<div class="metrics-header">\${metricInfo.title}</div>\`;
                if (metricInfo.description) {
                  html += \`<div class="metrics-description">\${metricInfo.description}</div>\`;
                }
                
                // Handle different types of metrics
                if (key === 'cpuUsage') {
                  html += \`<table class="metrics-table">
                    <tr>
                      <th>Metric</th>
                      <th>Value</th>
                      <th>Description</th>
                    </tr>
                    <tr>
                      <td>User CPU</td>
                      <td class="metrics-value">\${formatMicroseconds(value.user)}</td>
                      <td>\${metricInfo.fields?.user || ""}</td>
                    </tr>
                    <tr>
                      <td>System CPU</td>
                      <td class="metrics-value">\${formatMicroseconds(value.system)}</td>
                      <td>\${metricInfo.fields?.system || ""}</td>
                    </tr>
                  </table>\`;
                } else if (key === 'memoryUsage') {
                  html += \`<table class="metrics-table">
                    <tr>
                      <th>Metric</th>
                      <th>Value</th>
                      <th>Description</th>
                    </tr>\`;
                  
                  for (const [memKey, memValue] of Object.entries(value)) {
                    html += \`<tr>
                      <td>\${memKey}</td>
                      <td class="metrics-value">\${formatBytes(memValue)}</td>
                      <td>\${metricInfo.fields?.[memKey] || ""}</td>
                    </tr>\`;
                  }
                  
                  html += \`</table>\`;
                } else if (key === 'activeRequests') {
                  html += \`<div class="metrics-value">\${value} connections</div>\`;
                } else {
                  html += \`<div class="metrics-value">\${value}</div>\`;
                }
              }
              
              metricsContainer.innerHTML = html;
            })
            .catch(err => {
              console.error('Error fetching metrics:', err);
              document.getElementById('formatted-metrics').textContent = 'Error loading metrics';
            });
        }
        
        setInterval(updateMetrics, 1000);
        
        // Polling test
        document.getElementById('start-polling').addEventListener('click', () => {
          const clientCount = parseInt(document.getElementById('client-count').value, 10);
          const pollingInterval = parseInt(document.getElementById('polling-interval').value, 10);
          
          // Update button text to show current interval
          document.getElementById('start-polling').textContent = \`Start Polling Test (\${pollingInterval}ms)\`;
          
          // Clear previous tests
          pollingIntervals.forEach(clearInterval);
          pollingIntervals = [];
          pollCount = 0;
          pollTimes = [];
          document.getElementById('poll-count').textContent = '0';
          document.getElementById('poll-avg-time').textContent = '0ms';
          document.getElementById('poll-max-time').textContent = '0ms';
          
          // Start new polling for each simulated client
          for (let i = 0; i < clientCount; i++) {
            const intervalId = setInterval(() => {
              const startTime = performance.now();
              
              fetch('/poll')
                .then(response => response.json())
                .then(data => {
                  const endTime = performance.now();
                  const responseTime = endTime - startTime;
                  
                  pollTimes.push(responseTime);
                  if (pollTimes.length > 100) pollTimes.shift(); // Keep only last 100
                  
                  pollCount++;
                  document.getElementById('poll-count').textContent = pollCount;
                  
                  const avgTime = pollTimes.reduce((a, b) => a + b, 0) / pollTimes.length;
                  document.getElementById('poll-avg-time').textContent = avgTime.toFixed(2) + 'ms';
                  
                  const maxTime = Math.max(...pollTimes);
                  document.getElementById('poll-max-time').textContent = maxTime.toFixed(2) + 'ms';
                  
                  // Add to visualization
                  addBar('poll-bar', responseTime);
                })
                .catch(err => console.error('Polling error:', err));
            }, pollingInterval); // Use the user-specified polling interval
            
            pollingIntervals.push(intervalId);
          }
        });
        
        // SSE test
        document.getElementById('start-sse').addEventListener('click', () => {
          const clientCount = parseInt(document.getElementById('client-count').value, 10);
          
          // Clear previous SSE connections
          sseConnections.forEach(sse => sse.close());
          sseConnections = [];
          sseCount = 0;
          document.getElementById('sse-count').textContent = '0';
          document.getElementById('sse-connections').textContent = '0';
          
          // Create new SSE connections for each simulated client
          for (let i = 0; i < clientCount; i++) {
            const sse = new EventSource('/sse');
            
            sse.onmessage = (event) => {
              const data = JSON.parse(event.data);
              sseCount++;
              document.getElementById('sse-count').textContent = sseCount;
              document.getElementById('sse-connections').textContent = sseConnections.length;
              
              // Add to visualization (always fast since it's push-based)
              addBar('sse-bar', 5); // Typically ~5ms for server push
            };
            
            sse.onerror = () => {
              console.error('SSE connection error');
              sse.close();
              sseConnections = sseConnections.filter(s => s !== sse);
              document.getElementById('sse-connections').textContent = sseConnections.length;
            };
            
            sseConnections.push(sse);
          }
          
          document.getElementById('sse-connections').textContent = sseConnections.length;
        });
        
        // Stop all tests
        document.getElementById('stop-test').addEventListener('click', () => {
          pollingIntervals.forEach(clearInterval);
          pollingIntervals = [];
          
          sseConnections.forEach(sse => sse.close());
          sseConnections = [];
          
          document.getElementById('sse-connections').textContent = '0';
        });
        
        // Update client count
        document.getElementById('update-clients').addEventListener('click', () => {
          // Stop current tests first
          document.getElementById('stop-test').click();
          
          // Update polling button text with current interval
          const pollingInterval = parseInt(document.getElementById('polling-interval').value, 10);
          document.getElementById('start-polling').textContent = \`Start Polling Test (\${pollingInterval}ms)\`;
        });
        
        // Add a bar to the visualization
        function addBar(className, time) {
          const responseList = document.getElementById('response-list');
          const row = document.createElement('tr');
          const now = new Date();
          
          // Set class based on type
          const type = className === 'poll-bar' ? 'polling' : 'sse';
          row.className = \`response-row-\${type}\`;
          row.dataset.type = type;
          
          // Create type cell
          const typeCell = document.createElement('td');
          typeCell.textContent = type === 'polling' ? 'Polling' : 'SSE';
          typeCell.style.color = type === 'polling' ? '#d32f2f' : '#388e3c';
          typeCell.style.fontWeight = 'bold';
          
          // Create response time cell
          const timeCell = document.createElement('td');
          timeCell.className = 'response-time-cell';
          timeCell.textContent = time.toFixed(2) + 'ms';
          
          // Color code based on response time
          if (time < 50) {
            timeCell.className += ' time-fast';
          } else if (time < 200) {
            timeCell.className += ' time-medium';
          } else {
            timeCell.className += ' time-slow';
          }
          
          // Create timestamp cell
          const timestampCell = document.createElement('td');
          timestampCell.textContent = now.toLocaleTimeString() + '.' + now.getMilliseconds().toString().padStart(3, '0');
          
          // Add cells to row
          row.appendChild(typeCell);
          row.appendChild(timeCell);
          row.appendChild(timestampCell);
          
          // Add to list
          if (responseList.firstChild) {
            responseList.insertBefore(row, responseList.firstChild);
          } else {
            responseList.appendChild(row);
          }
          
          // Limit list size (keep last 100 entries)
          if (responseList.childNodes.length > 100) {
            responseList.removeChild(responseList.lastChild);
          }
          
          // Auto-scroll to top
          const scrollContainer = document.querySelector('.scroll-container');
          scrollContainer.scrollTop = 0;
        }
        
        // Add tab filtering functionality
        document.addEventListener('DOMContentLoaded', function() {
          const tabButtons = document.querySelectorAll('.tab-btn');
          
          tabButtons.forEach(button => {
            button.addEventListener('click', () => {
              // Update active tab
              tabButtons.forEach(btn => btn.classList.remove('active'));
              button.classList.add('active');
              
              // Filter rows
              const filter = button.dataset.tab;
              const rows = document.querySelectorAll('#response-list tr');
              
              rows.forEach(row => {
                if (filter === 'all' || row.dataset.type === filter) {
                  row.style.display = '';
                } else {
                  row.style.display = 'none';
                }
              });
            });
          });
          
          // Initialize metrics
          updateMetrics();
        });
      </script>
    </body>
    </html>
  `);
});

// 404 for all other routes
app.use(async (req, res) => {
  res.status(404).send("Not found");
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser to run the test`);
});

// Log CPU usage every 5 seconds
setInterval(() => {
  const usage = process.cpuUsage();
  const userCPUUsage = usage.user / 1000000; // Convert to seconds
  const systemCPUUsage = usage.system / 1000000; // Convert to seconds
  console.log(
    `CPU Usage - User: ${userCPUUsage.toFixed(2)}s, System: ${systemCPUUsage.toFixed(2)}s`,
  );
}, 5000);