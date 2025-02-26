// event-loop-demo.js
const http = require("http");
const EventEmitter = require("events");

// Simple event emitter to simulate updates
const dataSource = new EventEmitter();
let currentValue = 0;

// Simulate data updates every second
setInterval(() => {
  currentValue++;
  dataSource.emit("update", { value: currentValue, timestamp: Date.now() });
}, 1000);

// Create HTTP server
const server = http.createServer((req, res) => {
  // Simulate a Redis lookup (takes 5ms)
  const simulateRedisLookup = () => {
    const start = process.hrtime.bigint();
    // Simulate CPU work with a busy wait
    while (Number(process.hrtime.bigint() - start) / 1000000 < 5) {
      // Busy wait to simulate CPU work
    }
    return { value: currentValue, timestamp: Date.now() };
  };

  // Log request to see queue buildup
  const requestId = Date.now() + Math.random().toString(36).substring(2, 9);
  const requestTime = new Date().toISOString();
  console.log(`[${requestTime}] Request received: ${requestId} - ${req.url}`);

  // Metrics endpoint
  if (req.url === "/metrics") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        cpuUsage: process.cpuUsage(),
        activeRequests: server._connections,
        memoryUsage: process.memoryUsage(),
        currentValue,
      }),
    );
    return;
  }

  // Polling endpoint
  if (req.url === "/poll") {
    const data = simulateRedisLookup();

    // Add artificial delay to handle request (mimics actual work)
    setTimeout(() => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          data,
          server_processed_at: new Date().toISOString(),
          request_id: requestId,
        }),
      );

      console.log(
        `[${new Date().toISOString()}] Request completed: ${requestId}`,
      );
    }, 20); // 20ms processing time

    return;
  }

  // SSE endpoint
  if (req.url === "/sse") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // Send initial data
    const data = simulateRedisLookup();
    res.write(
      `data: ${JSON.stringify({
        data,
        server_processed_at: new Date().toISOString(),
        request_id: requestId,
      })}\n\n`,
    );

    // Listen for updates
    const updateListener = (data) => {
      res.write(
        `data: ${JSON.stringify({
          data,
          server_processed_at: new Date().toISOString(),
          request_id: requestId,
        })}\n\n`,
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

    return;
  }

  // Serve client test page
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
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
          
          /* Add these styles to your existing CSS */
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
          
          /* Define color indicators for response time */
          .time-fast {
            color: green;
          }
          
          .time-medium {
            color: orange;
          }
          
          .time-slow {
            color: red;
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
            <pre id="server-metrics">Loading...</pre>
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
          
          // Update metrics regularly
          function updateMetrics() {
            fetch('/metrics')
              .then(response => response.json())
              .then(data => {
                document.getElementById('server-metrics').textContent = JSON.stringify(data, null, 2);
              })
              .catch(err => console.error('Error fetching metrics:', err));
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
          
          // Replace the addBar function with this version
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
          });
        </script>
      </body>
      </html>
    `);
    return;
  }

  // Default response
  res.writeHead(404);
  res.end("Not found");
});

// Start the server
const PORT = process.env.PORT || 80;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser to run the test`);
});

// Log CPU usage every 5 seconds instead of event loop utilization
setInterval(() => {
  const usage = process.cpuUsage();
  const userCPUUsage = usage.user / 1000000; // Convert to seconds
  const systemCPUUsage = usage.system / 1000000; // Convert to seconds
  console.log(
    `CPU Usage - User: ${userCPUUsage.toFixed(2)}s, System: ${systemCPUUsage.toFixed(2)}s`,
  );
}, 5000);
