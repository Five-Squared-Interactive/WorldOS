# VOS
Virtual reality Operating System (VOS)

## MQTT Connectivity

### vosapp.js (Node.js)

The `vosapp.js` module provides a Node.js interface for connecting to the VOS MQTT bus.

#### Connecting to MQTT

```javascript
const VOSApp = require('./vosapp.js');
const app = new VOSApp();

// Connect to localhost (default)
app.ConnectToVOS("MyApp", onConnect);

// Connect to a remote MQTT server
app.ConnectToVOS("MyApp", onConnect, "mqtt.example.com");
```

**Configuration:**
- **Parameter**: Pass the MQTT host as the third parameter to `ConnectToVOS()`
- **Default**: Connects to `localhost` if no host is specified

### wosapp.py (Python)

The `wosapp.py` module provides a Python interface for connecting to the WOS MQTT bus.

#### Connecting to MQTT

```python
from wosapp import WOSApp

app = WOSApp()

# Connect to localhost (default)
app.ConnectToWOS("MyApp", 1883, on_connect)

# Connect to a remote MQTT server
app.ConnectToWOS("MyApp", 1883, on_connect, mqttHost="mqtt.example.com")
```

**Configuration:**
- **Parameter**: Pass the MQTT host as the `mqttHost` parameter to `ConnectToWOS()`
- **Default**: Connects to `localhost` if no host is specified

### Error Handling

Connection errors will be raised as exceptions and should be handled by the calling code. Errors are also logged for debugging purposes.
