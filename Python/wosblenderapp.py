import bpy
import sys
import os
import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from wosapp import WOSApp

# Try to import USD support - check for built-in USD first, then Omniverse
USD_AVAILABLE = False
OMNIVERSE_AVAILABLE = False

# Check for built-in USD support (Blender 4.0+)
try:
    from pxr import Usd, UsdGeom, Sdf
    USD_AVAILABLE = True
    print("USD support enabled via built-in Blender USD")
except ImportError:
    print("Built-in USD libraries not available")

# Check for Omniverse connector (optional, provides additional features)
try:
    import omni.client
    OMNIVERSE_AVAILABLE = True
    if USD_AVAILABLE:
        print("Omniverse connector also available for enhanced USD features")
    else:
        # Omniverse might provide USD libraries
        from pxr import Usd, UsdGeom, Sdf
        USD_AVAILABLE = True
        print("USD support enabled via Omniverse connector")
except ImportError:
    pass

if not USD_AVAILABLE:
    print("Warning: USD support not available. Consider installing Blender with USD support or Omniverse connector.")

def simplify_and_save(ratio=0.5, output_path="simplified_model.blend"):
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            decimate = obj.modifiers.new(name="DecimateMod", type='DECIMATE')
            decimate.ratio = ratio
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.modifier_apply(modifier=decimate.name)
    
    # Export based on file extension
    ext = output_path.lower().split('.')[-1]
    
    if ext in ['usd', 'usdc', 'usda']:
        if USD_AVAILABLE:
            export_to_usd(output_path)
        else:
            print("Warning: USD export requested but USD support not available. Exporting as GLB instead.")
            output_path = output_path.rsplit('.', 1)[0] + ".glb"
            bpy.ops.export_scene.gltf(filepath=output_path, export_format='GLB')
    elif ext in ['glb', 'gltf']:
        export_format = 'GLB' if ext == 'glb' else 'GLTF_SEPARATE'
        bpy.ops.export_scene.gltf(filepath=output_path, export_format=export_format)
    elif ext == 'obj':
        bpy.ops.export_scene.obj(filepath=output_path)
    elif ext == 'fbx':
        bpy.ops.export_scene.fbx(filepath=output_path)
    else:
        # Default to GLB for unsupported formats
        print(f"Warning: Unsupported export format '{ext}'. Exporting as GLB instead.")
        output_path = output_path.rsplit('.', 1)[0] + ".glb"
        bpy.ops.export_scene.gltf(filepath=output_path, export_format='GLB')
    
    print(f"Simplified model saved to {output_path}")

def export_to_usd(filepath):
    """Export scene to USD format using built-in Blender USD or Omniverse connector"""
    try:
        # Use Blender's built-in USD exporter if available (preferred method)
        if hasattr(bpy.ops.wm, 'usd_export'):
            bpy.ops.wm.usd_export(filepath=filepath)
            print(f"Exported using Blender's built-in USD exporter")
        else:
            # Fallback to manual USD creation
            stage = Usd.Stage.CreateNew(filepath)
            
            # Export each mesh object
            for obj in bpy.data.objects:
                if obj.type == 'MESH':
                    mesh_path = f"/{obj.name}"
                    mesh_prim = UsdGeom.Mesh.Define(stage, mesh_path)
                    
                    # Get mesh data
                    mesh = obj.data
                    mesh.calc_loop_triangles()
                    
                    # Set vertices
                    verts = [obj.matrix_world @ v.co for v in mesh.vertices]
                    mesh_prim.CreatePointsAttr(verts)
                    
                    # Set face vertex indices
                    face_vertex_indices = []
                    face_vertex_counts = []
                    for tri in mesh.loop_triangles:
                        face_vertex_indices.extend([tri.vertices[0], tri.vertices[1], tri.vertices[2]])
                        face_vertex_counts.append(3)
                    
                    mesh_prim.CreateFaceVertexIndicesAttr(face_vertex_indices)
                    mesh_prim.CreateFaceVertexCountsAttr(face_vertex_counts)
            
            stage.GetRootLayer().Save()
        
        print(f"Successfully exported to USD: {filepath}")
    except Exception as e:
        print(f"Error exporting to USD: {e}")
        # Fallback to GLB export
        glb_path = filepath.rsplit('.', 1)[0] + ".glb"
        bpy.ops.export_scene.gltf(filepath=glb_path, export_format='GLB')
        print(f"Exported as GLB instead: {glb_path}")

def load_usd_file(filepath):
    """Load USD file using built-in Blender USD or Omniverse connector"""
    try:
        # Use Blender's built-in USD importer if available (preferred method)
        if hasattr(bpy.ops.wm, 'usd_import'):
            bpy.ops.wm.usd_import(filepath=filepath)
            print(f"Imported using Blender's built-in USD importer")
        else:
            # Fallback to manual USD loading
            stage = Usd.Stage.Open(filepath)
            
            # Import each mesh primitive
            for prim in stage.Traverse():
                if prim.IsA(UsdGeom.Mesh):
                    mesh_geom = UsdGeom.Mesh(prim)
                    
                    # Create new mesh in Blender
                    mesh_name = prim.GetName()
                    mesh = bpy.data.meshes.new(mesh_name)
                    obj = bpy.data.objects.new(mesh_name, mesh)
                    bpy.context.collection.objects.link(obj)
                    
                    # Get USD mesh data
                    points_attr = mesh_geom.GetPointsAttr()
                    if points_attr:
                        points = points_attr.Get()
                        vertices = [(p[0], p[1], p[2]) for p in points]
                        
                        face_indices_attr = mesh_geom.GetFaceVertexIndicesAttr()
                        face_counts_attr = mesh_geom.GetFaceVertexCountsAttr()
                        
                        if face_indices_attr and face_counts_attr:
                            face_indices = face_indices_attr.Get()
                            face_counts = face_counts_attr.Get()
                            
                            # Convert to Blender faces
                            faces = []
                            idx = 0
                            for count in face_counts:
                                face = tuple(face_indices[idx:idx+count])
                                faces.append(face)
                                idx += count
                            
                            # Create mesh
                            mesh.from_pydata(vertices, [], faces)
                            mesh.update()
        
        print(f"Successfully loaded USD file: {filepath}")
    except Exception as e:
        print(f"Error loading USD file: {e}")
        raise

def initialize_omniverse():
    """Initialize Omniverse client if available"""
    if OMNIVERSE_AVAILABLE:
        try:
            # Initialize Omniverse client
            omni.client.initialize()
            print("Omniverse client initialized successfully")
            return True
        except Exception as e:
            print(f"Warning: Failed to initialize Omniverse client: {e}")
            return False
    return False

def shutdown_omniverse():
    """Shutdown Omniverse client"""
    if OMNIVERSE_AVAILABLE:
        try:
            omni.client.shutdown()
            print("Omniverse client shutdown")
        except Exception as e:
            print(f"Warning: Error shutting down Omniverse client: {e}")

def on_connect():
    print("Headless: Connected to MQTT bus.")

def on_message(topic, message):
    print(f"Headless: Received on {topic}: {message.decode()}")

def main():
    if len(sys.argv) < 5:
        print("Usage: blender --background --python wosblenderapp.py -- <mqtt_port> <model_path> [output_format]")
        print("Supported output formats: glb, gltf, usd, usdc, usda, obj, fbx")
        print("If no output format is specified, the original format will be preserved")
        sys.exit(1)
    
    # Initialize Omniverse if available
    omniverse_initialized = initialize_omniverse()
    
    mqtt_port = sys.argv[5]
    model_path = sys.argv[6]
    
    # Check for optional output format argument
    output_format = None
    if len(sys.argv) >= 8:
        output_format = sys.argv[7].lower().strip('.')
        # Validate output format
        supported_formats = ['glb', 'gltf', 'usd', 'usdc', 'usda', 'obj', 'fbx']
        if output_format not in supported_formats:
            print(f"Error: Unsupported output format '{output_format}'")
            print(f"Supported formats: {', '.join(supported_formats)}")
            sys.exit(1)
    
    # Load the model (supports .blend, .obj, .fbx, .usd, .usdc, .usda, etc.)
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
    elif model_path.lower().endswith((".usd", ".usdc", ".usda")):
        if USD_AVAILABLE:
            load_usd_file(model_path)
        else:
            print("Error: USD file format detected but USD support not available.")
            print("Please install the Blender Omniverse connector for USD support.")
            sys.exit(1)
    else:
        print("Unsupported file format.")
        print("Supported formats: .blend, .obj, .fbx, .glb, .gltf, .usd, .usdc, .usda")
        sys.exit(1)
    
    # Generate output path with "_simplified" before extension
    base, ext = os.path.splitext(model_path)
    
    if output_format:
        # Use specified output format
        output_path = base + "_simplified." + output_format
        # Check if USD format is requested but not available
        if output_format in ['usd', 'usdc', 'usda'] and not USD_AVAILABLE:
            print(f"Warning: USD output format '{output_format}' requested but USD support not available.")
            print("Falling back to GLB format.")
            output_path = base + "_simplified.glb"
    else:
        # Preserve original format if no output format specified
        if ext.lower() in ['.usd', '.usdc', '.usda'] and USD_AVAILABLE:
            output_path = base + "_simplified" + ext
        else:
            output_path = base + "_simplified.glb"

    app = WOSApp()
    app.ConnectToWOS("BlenderHeadless", mqtt_port, on_connect)
    app.SubscribeToWOS("BlenderHeadless", "test/topic", on_message)
    app.PublishOnWOS("BlenderHeadless", "test/topic", "Hello from Blender headless!")

    simplify_and_save(ratio=0.5, output_path=output_path)

    # Cleanup
    shutdown_omniverse()
    
    app.loop_forever()

if __name__ == "__main__":
    main()