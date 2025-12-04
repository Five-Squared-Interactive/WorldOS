// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

const { argv } = require("process");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const mqtt = require("mqtt");
const { versionString } = require("./version.js");

/**
 * Configuration File name.
 */
const CONFIGFILENAME = ".config-temp";

/**
 * @function Initialize Initialize the server.
 */
Initialize = function() {
    this.startupApps = [];
    this.messageTriggeredApps = [];
}

/**
 * @function GetConfiguration Get Configuration.
 * @param {*} configFile Path to file containing configuration.
 */
GetConfiguration = function(configFile) {
    data = fs.readFileSync(configFile);

    if (data == null) {
        return null;
    }

    config = JSON.parse(data);

    if (config["server-name"] === null) {
        config["server-name"] = "Unset";
    }

    if (config["bus-port"] === null) {
        config["bus-port"] = 5525;
    }

    if (config["startup-apps"] === null) {
        config["startup-apps"] = [];
    }

    config["startup-apps"].forEach((startupApp) => {
        if (startupApp["name"] === null) {
            startupApp["name"] = "Unnamed";
        }

        if (startupApp["command"] === null) {
            startupApp["command"] = "";
        }

        if (startupApp["args"] === null) {
            startupApp["args"] = [];
        }
        startupApp["args"].push(config["bus-port"]);
    });

    config["message-triggered-apps"].forEach((msgTriggeredApp) => {
        if (msgTriggeredApp["name"] === null) {
            msgTriggeredApp["name"] = "Unnamed";
        }

        if (msgTriggeredApp["topic"] === null) {
            msgTriggeredApp["topic"] = "";
        }

        if (msgTriggeredApp["command"] === null) {
            msgTriggeredApp["command"] = ""
        }

        if (msgTriggeredApp["default-args"] === null) {
            msgTriggeredApp["default-args"] = [];
        }
        msgTriggeredApp["default-args"].push(config["bus-port"]);
    });

    return config;
}

/**
 * @function RegisterMessageTriggeredApp Register a message triggered app.
 * @param {*} appName Name of the app.
 * @param {*} topic Topic that the app will be triggered by.
 * @param {*} appCommand Command for the app.
 * @param {*} args Array of arguments to the app.
 */
RegisterMessageTriggeredApp = function(appName, topic, appCommand, args) {
    Log("[WOSServer] Registering app " + appName + "...");
    this.messageTriggeredApps.push({
        "name": appName,
        "topic": topic,
        "command": appCommand,
        "args": args
    });
    Log("[WOSServer] App " + appName + " registered.");
}

/**
 * @function RunStartupApp Run a startup app.
 * @param {*} appName Name of the app.
 * @param {*} appCommand Command for the app.
 * @param {*} args Array of arguments to the app.
 */
RunStartupApp = function(appName, appCommand, args) {
    Log("[WOSServer] Starting app " + appName + "...");
    appProcess = spawn(appCommand, args, { detached: true });
    appProcess.on("error", (err) => {
        Log("[" + appName + "] " + err);
    });
      
    appProcess.on('exit', (code, signal) => {
        if (code !== 0) {
            Log("[" + appName + "] Exited with code " + code + " and signal " + signal  + ".");
        } else {
            Log("[" + appName + "] Exited with code 0.");
        }
    });
      
    appProcess.stdout.on('data', (data) => {
        Log("[" + appName + "] " + data);
    });
      
    appProcess.stderr.on('data', (data) => {
        Log("[" + appName + "] " + data);
    });
    this.startupApps.push(appProcess);
    Log("[WOSServer] App " + appName + " started.");
}

/**
 * @function TerminateStartupApps Terminate all startup apps.
 */
TerminateStartupApps = function() {
    this.startupApps.forEach((appProcess) => {
        appProcess.kill();
    });
}

/**
 * @function RunMQTT Run MQTT process.
 * @param {*} port Port.
 */
RunMQTT = function(port, caFile = null, privateKeyFile = null, certFile = null) {
    Log("[WOSBus] Version " + versionString);
    Log("[WOSBus] Starting MQTT bus...");
    var config = `listener ${port}\nprotocol mqtt`;
    if (caFile != null && privateKeyFile != null && certFile != null) {
        config = `${config}\ncafile ${caFile}\ncertfile ${certFile}\nkeyfile ${privateKeyFile}`;
    }
    config = `${config}\nallow_anonymous true`;
    fs.writeFileSync(CONFIGFILENAME, config);
    if (process.platform == "win32") {
        this.mosquittoProcess = spawn(path.join(__dirname, "Mosquitto\\mosquitto.exe"),
            ["-c", CONFIGFILENAME], {detached: true});
        Log("[WOSBus] MQTT bus started.");
        ConnectToMQTT(port);
    } else {
        this.mosquittoProcess = spawn("mosquitto", ["-c", CONFIGFILENAME], {detached: true});
        Log("[WOSBus] MQTT bus started.");
        ConnectToMQTT(port);
    }
    this.mosquittoProcess.stdout.on('data', (data) => {
        Log(`[WOSBus] ${data}`);
    });
    this.mosquittoProcess.stderr.on('data', (data) => {
        Log(`[WOSBus] ${data}`);
    });
    this.mosquittoProcess.on('close', (code) => {
        Log(`[WOSBus] MQTT server exited ${code}`);
    });
}

/**
 * @function StopMQTT Stop MQTT process.
 */
StopMQTT = function() {
    Log("[WOSBus] Stopping MQTT bus...");
    if (this.mosquittoProcess != null)
    {
        process.kill(this.mosquittoProcess.pid);
        if (fs.existsSync(CONFIGFILENAME)) {
            fs.rmSync(CONFIGFILENAME);
        }
        Log("[WOSBus] MQTT bus stopped.");
    }
    else {
        Log("[WOSBus] Error stopping MQTT bus.");
    }
}

/**
     * @function ConnectToMQTT Connect to MQTT server.
     * @param {*} port Port.
     */
ConnectToMQTT = function(port) {
    Log("[WOSServer] Connecting to MQTT bus...");
    client = mqtt.connect(`mqtt://localhost:${port}`);
    client.on('connect', function()  {
        client.subscribe("wos/app/#", function(err) {
            if (err) {
                Log("[WOSServer] Error connecting to MQTT bus.");
            } else {
                Log("[WOSServer] Connected to MQTT bus.");
            }
        });
    });

    client.on('message', function(topic, message) {
        ProcessMessage(topic, message);
    });
}

/**
 * @function ProcessMessage Process a Message.
 * @param {*} topic Topic.
 * @param {*} message Message.
 */
ProcessMessage = function(topic, message) {
    formattedTopic = topic.toLowerCase();
    this.messageTriggeredApps.forEach((messageTriggeredApp) => {
        if (messageTriggeredApp["topic"] === formattedTopic
            && messageTriggeredApp["command"] != null
            && messageTriggeredApp["default-args"] != null) {
            commandArgs = messageTriggeredApp["default-args"].slice();
            commandArgs.push("topic=" + formattedTopic);
            commandArgs.push("wosmessage=" + message);
            spawn(messageTriggeredApp["command"], commandArgs, { detached: true });
        }
    });
}

/**
 * @function Log Log a message.
 * @param {*} text Text to log.
 */
Log = function(text) {
    console.log(text);
    if (process.platform == "win32") {
        fs.appendFile(".\\wos.log", text + "\n", function(err){
            
        });
    } else {
        fs.appendFile("./wos.log", text + "\n", function(err){

        });
    }
}

if (process.platform === "win32") {
    var rl = require("readline").createInterface({
      input: process.stdin,
      output: process.stdout
    });
  
    rl.on("SIGINT", function () {
      TerminateStartupApps();
      process.emit("SIGINT");
    });
}

process.on('SIGINT', function() {
    TerminateStartupApps();
    StopMQTT();
    process.exit();
});

Initialize();
Log("[WOSServer] Getting configuration...");
var config = GetConfiguration(argv[2]);
Log("[WOSServer] Starting server " + config["server-name"]);
RunMQTT(config["bus-port"]);
Log("[WOSServer] Registering message triggered apps...");
config["message-triggered-apps"].forEach((messageTriggeredApp) => {
    if (messageTriggeredApp["topic"] === null || messageTriggeredApp["topic"] === "" ||
        messageTriggeredApp["command"] === null || messageTriggeredApp["command"] == "") {
        Log("[WOSServer] Invalid message triggered app " + messageTriggeredApp["name"] + ". Skipping...");
    }
    else {
        RegisterMessageTriggeredApp(messageTriggeredApp["name"], messageTriggeredApp["topic"],
            messageTriggeredApp["command"], messageTriggeredApp["args"]);
    }
});
Log("[WOSServer] Message triggered apps registered.");
config["startup-apps"].forEach((startupApp) => {
    if (startupApp["command"] === null || startupApp["command"] === "") {
        Log("[WOSServer] Invalid startup app " + startupApp["name"] + ". Skipping...");
    }
    else {
        RunStartupApp(startupApp["name"], startupApp["command"], startupApp["args"]);
    }
});