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

    this.ConnectToVOS = function(appName, onConnect) {
        vosPort = argv[argv.length - 1];
        this.Log("[" + appName + "] Connecting to MQTT bus...");
        this.client = mqtt.connect(`mqtt://localhost:${vosPort}`);
        context = this;
        this.client.on('connect', function() {
            context.Log("[" + appName + "] Connected to MQTT bus.");
            onConnect();
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