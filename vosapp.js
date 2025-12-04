// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

const { argv } = require("process");
const fs = require("fs");
const mqtt = require("mqtt");

module.exports = function() {
    /**
     * @function Log Log a message.
     * @param {*} text Text to log.
     */
    this.Log = function(text) {
        console.log(text);
        if (process.platform == "win32") {
            fs.appendFile(".\\vos.log", text + "\n", function(err){
                
            });
        } else {
            fs.appendFile("./vos.log", text + "\n", function(err){
    
            });
        }
    }

    /**
     * @function ConnectToVOS Connect to the VOS MQTT bus.
     * @param {*} appName Name of the application.
     * @param {*} onConnect Callback function called when connected.
     * @param {*} mqttHost Optional MQTT host address. Defaults to localhost.
     *                     Can also be set via VOS_MQTT_HOST environment variable.
     */
    this.ConnectToVOS = function(appName, onConnect, mqttHost) {
        vosPort = argv[argv.length - 1];
        // Priority: 1. Explicit parameter, 2. Environment variable, 3. Default to localhost
        var host = mqttHost || process.env.VOS_MQTT_HOST || "localhost";
        this.Log("[" + appName + "] Connecting to MQTT bus at " + host + ":" + vosPort + "...");
        try {
            this.client = mqtt.connect(`mqtt://${host}:${vosPort}`);
        } catch (err) {
            this.Log("[" + appName + "] Error creating MQTT connection: " + err.message + ". Falling back to localhost.");
            this.client = mqtt.connect(`mqtt://localhost:${vosPort}`);
        }
        context = this;
        this.client.on('connect', function() {
            context.Log("[" + appName + "] Connected to MQTT bus.");
            onConnect();
        });
        this.client.on('error', function(err) {
            context.Log("[" + appName + "] MQTT connection error: " + err.message);
        });
    }

    this.SubscribeToVOS = function(appName, subscriptionTopic, onMessage) {
        if (this.client == null) {
            this.Log("[" + appName + "] VOS not connected.");
            return;
        }

        context = this;
        this.client.subscribe(subscriptionTopic, function(err) {
            if (err) {
                context.Log("[" + appName + "] Error subscribing to " + subscriptionTopic + ".");
            } else {
                context.Log("[" + appName + "] Subscribed to " + subscriptionTopic + ".");
            }
        });
    
        this.client.on('message', function(topic, message) {
            onMessage(topic, message);
        });
    }

    this.PublishOnVOS = function(topic, message) {
        if (this.client == null) {
            this.Log("[" + appName + "] VOS not connected.");
            return;
        }

        this.client.publish(topic, message);
    }
}