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
            fs.appendFile(".\\wos.log", text + "\n", function(err){
                
            });
        } else {
            fs.appendFile("./wos.log", text + "\n", function(err){
    
            });
        }
    }

    /**
     * @function ConnectToWOS Connect to the WOS MQTT bus.
     * @param {*} appName Name of the application.
     * @param {*} onConnect Callback function called when connected.
     * @param {*} mqttHost Optional MQTT host address. Defaults to localhost.
     */
    this.ConnectToWOS = function(appName, onConnect, mqttHost) {
        wosPort = argv[argv.length - 1];
        // Use provided host or default to localhost
        var host = mqttHost || "localhost";
        this.Log("[" + appName + "] Connecting to MQTT bus at " + host + ":" + wosPort + "...");
        this.client = mqtt.connect(`mqtt://${host}:${wosPort}`);
        context = this;
        this.client.on('connect', function() {
            context.Log("[" + appName + "] Connected to MQTT bus.");
            onConnect();
        });
        this.client.on('error', function(err) {
            context.Log("[" + appName + "] MQTT connection error: " + err.message);
            throw err;
        });
    }

    this.SubscribeToWOS = function(appName, subscriptionTopic, onMessage) {
        if (this.client == null) {
            this.Log("[" + appName + "] WOS not connected.");
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

    this.PublishOnWOS = function(topic, message) {
        if (this.client == null) {
            this.Log("[" + appName + "] WOS not connected.");
            return;
        }

        this.client.publish(topic, message);
    }
}