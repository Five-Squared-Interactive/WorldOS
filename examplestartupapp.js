// Copyright (c) 2019-2024 Five Squared Interactive. All rights reserved.

const { argv } = require("process");
const fs = require("fs");
const mqtt = require("mqtt");

/**
 * @function ConnectToMQTT Connect to MQTT server.
 * @param {*} port Port.
 */
ConnectToMQTT = function(port) {
    Log("[ExampleStartupApp] Connecting to MQTT bus...");
    this.client = mqtt.connect(`mqtt://localhost:${port}`);
    this.client.on('connect', function()  {
        client.subscribe("vos/app/#", function(err) {
            if (err) {
                Log("[ExampleStartupApp] Error connecting to MQTT bus.");
            } else {
                Log("[ExampleStartupApp] Connected to MQTT bus.");
            }
        });
    });

    this.client.on('message', function(topic, message) {
        Log("Got Message:\nTopic: " + topic + "\nBody:" + message);
    });
}

/**
 * @function SendMessageToSelf Send message to self.
 */
SendMessageToSelf = function() {
    if (this.client != null) {
        Log("[ExampleStartupApp] Sending message to self...");
        this.client.publish("vos/app/test", "test-message");
    }
}

/**
 * @function Log Log a message.
 * @param {*} text Text to log.
 */
Log = function(text) {
    console.log(text);
    if (process.platform == "win32") {
        fs.appendFile(".\\examplestartupapp.log", text + "\n", function(err){
            
        });
    } else {
        fs.appendFile("./examplestartupapp.log", text + "\n", function(err){

        });
    }
}

ConnectToMQTT(argv[2]);
setInterval(() => {
    SendMessageToSelf();
}, 5000);