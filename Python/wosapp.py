import logging
import paho.mqtt.client as mqtt

class WOSApp:
    def __init__(self):
        self.client = None
        self.logger = logging.getLogger("WOSApp")
        handler = logging.FileHandler("wos.log", mode="a", encoding="utf-8")
        formatter = logging.Formatter('%(asctime)s %(message)s')
        handler.setFormatter(formatter)
        self.logger.addHandler(handler)
        self.logger.setLevel(logging.INFO)

    def Log(self, text):
        print(text)
        self.logger.info(text)

    def ConnectToWOS(self, appName, wosPort, onConnect):
        self.Log(f"[{appName}] Connecting to MQTT bus...")
        self.client = mqtt.Client()
        def _on_connect(client, userdata, flags, rc):
            self.Log(f"[{appName}] Connected to MQTT bus.")
            onConnect()
        self.client.on_connect = _on_connect

        print(f"Connecting to MQTT on port {wosPort}...")
        self.client.connect("localhost", int(wosPort), 60)

    def SubscribeToWOS(self, appName, subscriptionTopic, onMessage):
        if self.client is None:
            self.Log(f"[{appName}] WOS not connected.")
            return

        def _on_subscribe(client, userdata, mid, granted_qos):
            self.Log(f"[{appName}] Subscribed to {subscriptionTopic}.")

        def _on_message(client, userdata, msg):
            onMessage(msg.topic, msg.payload)

        self.client.subscribe(subscriptionTopic)
        self.client.on_subscribe = _on_subscribe
        self.client.on_message = _on_message

    def PublishOnWOS(self, appName, topic, message):
        if self.client is None:
            self.Log(f"[{appName}] WOS not connected.")
            return
        self.client.publish(topic, message)

    def loop_forever(self):
        if self.client:
            self.client.loop_forever()