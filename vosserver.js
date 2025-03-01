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
    Log("[VOSServer] Registering app " + appName + "...");
    this.messageTriggeredApps.push({
        "name": appName,
        "topic": topic,
        "command": appCommand,
        "args": args
    });
    Log("[VOSServer] App " + appName + " registered.");
}

/**
 * @function RunStartupApp Run a startup app.
 * @param {*} appName Name of the app.
 * @param {*} appCommand Command for the app.
 * @param {*} args Array of arguments to the app.
 */
RunStartupApp = function(appName, appCommand, args) {
    Log("[VOSServer] Starting app " + appName + "...");
    appProcess = spawn(appCommand, args, { detached: true });
    this.startupApps.push(appProcess);
    Log("[VOSServer] App " + appName + " started.");
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
    Log("[VOSBus] Version " + versionString);
    Log("[VOSBus] Starting MQTT bus...");
    var config = `listener ${port}\nprotocol mqtt`;
    if (caFile != null && privateKeyFile != null && certFile != null) {
        config = `${config}\ncafile ${caFile}\ncertfile ${certFile}\nkeyfile ${privateKeyFile}`;
    }
    config = `${config}\nallow_anonymous true`;
    fs.writeFileSync(CONFIGFILENAME, config);
    if (process.platform == "win32") {
        this.mosquittoProcess = spawn(path.join(__dirname, "Mosquitto\\mosquitto.exe"),
            ["-c", CONFIGFILENAME], {detached: true});
        Log("[VOSBus] MQTT bus started.");
        ConnectToMQTT(port);
    } else {
        this.mosquittoProcess = spawn("mosquitto", ["-c", CONFIGFILENAME], {detached: true});
        Log("[VOSBus] MQTT bus started.");
        ConnectToMQTT(port);
    }
    this.mosquittoProcess.stdout.on('data', (data) => {
        Log(`[VOSBus] ${data}`);
    });
    this.mosquittoProcess.stderr.on('data', (data) => {
        Log(`[VOSBus] ${data}`);
    });
    this.mosquittoProcess.on('close', (code) => {
        Log(`[VOSBus] MQTT server exited ${code}`);
    });
}

/**
 * @function StopMQTT Stop MQTT process.
 */
StopMQTT = function() {
    Log("[VOSBus] Stopping MQTT bus...");
    if (this.mosquittoProcess != null)
    {
        process.kill(this.mosquittoProcess.pid);
        if (fs.existsSync(CONFIGFILENAME)) {
            fs.rmSync(CONFIGFILENAME);
        }
        Log("[VOSBus] MQTT bus stopped.");
    }
    else {
        Log("[VOSBus] Error stopping MQTT bus.");
    }
}

/**
     * @function ConnectToMQTT Connect to MQTT server.
     * @param {*} port Port.
     */
ConnectToMQTT = function(port) {
    Log("[VOSServer] Connecting to MQTT bus...");
    client = mqtt.connect(`mqtt://localhost:${port}`);
    client.on('connect', function()  {
        client.subscribe("vos/app/#", function(err) {
            if (err) {
                Log("[VOSServer] Error connecting to MQTT bus.");
            } else {
                Log("[VOSServer] Connected to MQTT bus.");
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
            commandArgs.push("vosmessage=" + message);
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
        fs.appendFile(".\\vos.log", text + "\n", function(err){
            
        });
    } else {
        fs.appendFile("./vos.log", text + "\n", function(err){

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
Log("[VOSServer] Getting configuration...");
var config = GetConfiguration(argv[2]);
Log("[VOSServer] Starting server " + config["server-name"]);
RunMQTT(config["bus-port"]);
Log("[VOSServer] Registering message triggered apps...");
config["message-triggered-apps"].forEach((messageTriggeredApp) => {
    if (messageTriggeredApp["topic"] === null || messageTriggeredApp["topic"] === "" ||
        messageTriggeredApp["command"] === null || messageTriggeredApp["command"] == "") {
        Log("[VOSServer] Invalid message triggered app " + messageTriggeredApp["name"] + ". Skipping...");
    }
    else {
        RegisterMessageTriggeredApp(messageTriggeredApp["name"], messageTriggeredApp["topic"],
            messageTriggeredApp["command"], messageTriggeredApp["args"]);
    }
});
Log("[VOSServer] Message triggered apps registered.");
config["startup-apps"].forEach((startupApp) => {
    if (startupApp["command"] === null || startupApp["command"] === "") {
        Log("[VOSServer] Invalid startup app " + startupApp["name"] + ". Skipping...");
    }
    else {
        RunStartupApp(startupApp["name"], startupApp["command"], startupApp["args"]);
    }
});