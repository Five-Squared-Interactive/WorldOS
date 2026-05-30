# Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

"""
Blender Worker Script

Runs inside Blender's Python (headless). Loads a model, optionally decimates it,
and exports to the requested format.

Usage (called by plugin.py, not directly):
    blender --background --python worker.py -- <input_path> <output_path> <ratio>
"""

import bpy
import os
import sys

# Try to import USD support (Blender 4.0+)
USD_AVAILABLE = False
try:
    from pxr import Usd, UsdGeom
    USD_AVAILABLE = True
except ImportError:
    pass


def clear_scene():
    """Remove default objects from the scene."""
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)


def load_model(path):
    """Load a model file into Blender."""
    ext = os.path.splitext(path)[1].lower()
    clear_scene()

    if ext == ".blend":
        bpy.ops.wm.open_mainfile(filepath=path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    elif ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext in (".usd", ".usdc", ".usda"):
        if USD_AVAILABLE and hasattr(bpy.ops.wm, 'usd_import'):
            bpy.ops.wm.usd_import(filepath=path)
        else:
            print(f"Error: USD import not available for {path}")
            sys.exit(1)
    else:
        print(f"Error: Unsupported input format: {ext}")
        sys.exit(1)

    print(f"Loaded: {path}")


def decimate(ratio):
    """Apply decimation to all mesh objects."""
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            mod = obj.modifiers.new(name="Decimate", type='DECIMATE')
            mod.ratio = ratio
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.modifier_apply(modifier=mod.name)
    print(f"Decimated all meshes (ratio={ratio})")


def export_model(path):
    """Export the scene to the given path based on extension."""
    ext = os.path.splitext(path)[1].lower()

    if ext in ('.glb', '.gltf'):
        fmt = 'GLB' if ext == '.glb' else 'GLTF_SEPARATE'
        bpy.ops.export_scene.gltf(filepath=path, export_format=fmt)
    elif ext == '.obj':
        bpy.ops.wm.obj_export(filepath=path)
    elif ext == '.fbx':
        bpy.ops.export_scene.fbx(filepath=path)
    elif ext in ('.usd', '.usdc', '.usda'):
        if hasattr(bpy.ops.wm, 'usd_export'):
            bpy.ops.wm.usd_export(filepath=path)
        else:
            # Fallback to GLB
            fallback = os.path.splitext(path)[0] + ".glb"
            bpy.ops.export_scene.gltf(filepath=fallback, export_format='GLB')
            print(f"Warning: USD export unavailable, exported GLB instead: {fallback}")
            return
    else:
        # Fallback to GLB
        fallback = os.path.splitext(path)[0] + ".glb"
        bpy.ops.export_scene.gltf(filepath=fallback, export_format='GLB')
        print(f"Warning: Unknown format '{ext}', exported GLB instead: {fallback}")
        return

    print(f"Exported: {path}")


def main():
    # Parse args after "--"
    try:
        sep = sys.argv.index("--")
    except ValueError:
        print("Error: expected arguments after '--'")
        sys.exit(1)

    args = sys.argv[sep + 1:]
    if len(args) < 3:
        print("Usage: blender --background --python worker.py -- <input> <output> <ratio>")
        sys.exit(1)

    input_path = args[0]
    output_path = args[1]
    ratio = float(args[2])

    if not os.path.isfile(input_path):
        print(f"Error: input file not found: {input_path}")
        sys.exit(1)

    load_model(input_path)

    if ratio < 1.0:
        decimate(ratio)

    # Ensure output directory exists
    out_dir = os.path.dirname(output_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    export_model(output_path)
    print("Done.")


if __name__ == "__main__":
    main()
