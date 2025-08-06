import bpy
import sys
import os
import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from wosapp import WOSApp

def simplify_and_save(ratio=0.5, output_path="simplified_model.blend"):
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            decimate = obj.modifiers.new(name="DecimateMod", type='DECIMATE')
            decimate.ratio = ratio
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.modifier_apply(modifier=decimate.name)
    bpy.ops.export_scene.gltf(filepath=output_path, export_format='GLB')
    print(f"Simplified model saved to {output_path}")

def on_connect():
    print("Headless: Connected to MQTT bus.")

def on_message(topic, message):
    print(f"Headless: Received on {topic}: {message.decode()}")

def main():
    if len(sys.argv) < 5:
        print("Usage: blender --background --python wosheadlessblenderapp.py -- <mqtt_port> <model_path>")
        sys.exit(1)
    
    mqtt_port = sys.argv[5]
    model_path = sys.argv[6]
    
    # Load the model (supports .blend, .obj, .fbx, etc.)
    if model_path.lower().endswith(".blend"):
        bpy.ops.wm.open_mainfile(filepath=model_path)
    elif model_path.lower().endswith(".obj"):
        bpy.ops.import_scene.obj(filepath=model_path)
    elif model_path.lower().endswith(".fbx"):
        bpy.ops.import_scene.fbx(filepath=model_path)
    elif model_path.lower().endswith(".glb"):
        bpy.ops.import_scene.gltf(filepath=model_path)
    elif model_path.lower().endswith(".gltf"):
        bpy.ops.import_scene.gltf(filepath=model_path)
    else:
        print("Unsupported file format.")
        sys.exit(1)
    
    # Generate output path with "_simplified" before extension and .glb extension
    base, _ = os.path.splitext(model_path)
    output_path = base + "_simplified.glb"

    app = WOSApp()
    app.ConnectToWOS("BlenderHeadless", mqtt_port, on_connect)
    app.SubscribeToWOS("BlenderHeadless", "test/topic", on_message)
    app.PublishOnWOS("BlenderHeadless", "test/topic", "Hello from Blender headless!")

    simplify_and_save(ratio=0.5, output_path=output_path)

    app.loop_forever()

if __name__ == "__main__":
    main()