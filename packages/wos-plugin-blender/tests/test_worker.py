# Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

"""
Blender worker tests — runs inside Blender's Python.

Usage:
    blender --background --python tests/test_worker.py
"""

import bpy
import os
import sys
import tempfile
import traceback

# Add parent dir so we can import worker
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Ensure user site-packages is on path for paho-mqtt etc.
import site
user_site = site.getusersitepackages()
if user_site not in sys.path:
    sys.path.append(user_site)

import worker

_results = {"passed": 0, "failed": 0, "errors": []}


def run_test(name, fn):
    try:
        fn()
        _results["passed"] += 1
        print(f"  PASS: {name}")
    except AssertionError as e:
        _results["failed"] += 1
        _results["errors"].append((name, str(e)))
        print(f"  FAIL: {name} — {e}")
    except Exception as e:
        _results["failed"] += 1
        _results["errors"].append((name, traceback.format_exc()))
        print(f"  ERROR: {name} — {e}")


def count_meshes():
    return sum(1 for o in bpy.data.objects if o.type == 'MESH')


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_clear_scene():
    """clear_scene removes all objects."""
    bpy.ops.wm.read_homefile(use_empty=False)
    assert len(bpy.data.objects) > 0
    worker.clear_scene()
    assert len(bpy.data.objects) == 0


def test_load_and_export_glb():
    """Round-trip: create cube, export GLB, reload, verify mesh."""
    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.ops.mesh.primitive_cube_add(size=2)

    with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as f:
        glb_path = f.name
    try:
        worker.export_model(glb_path)
        assert os.path.isfile(glb_path), "GLB not created"
        assert os.path.getsize(glb_path) > 0, "GLB is empty"

        # Reload
        worker.load_model(glb_path)
        assert count_meshes() >= 1, "No mesh after GLB reimport"
    finally:
        os.unlink(glb_path)


def test_load_and_export_obj():
    """Round-trip: create sphere, export OBJ, reload, verify mesh."""
    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1)

    with tempfile.NamedTemporaryFile(suffix=".obj", delete=False) as f:
        obj_path = f.name
    try:
        worker.export_model(obj_path)
        assert os.path.isfile(obj_path), "OBJ not created"

        worker.load_model(obj_path)
        assert count_meshes() >= 1, "No mesh after OBJ reimport"
    finally:
        os.unlink(obj_path)


def test_load_and_export_fbx():
    """Round-trip: create cube, export FBX, reload, verify mesh."""
    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.ops.mesh.primitive_cube_add(size=2)

    with tempfile.NamedTemporaryFile(suffix=".fbx", delete=False) as f:
        fbx_path = f.name
    try:
        worker.export_model(fbx_path)
        assert os.path.isfile(fbx_path), "FBX not created"

        worker.load_model(fbx_path)
        assert count_meshes() >= 1, "No mesh after FBX reimport"
    finally:
        os.unlink(fbx_path)


def test_decimate_reduces_verts():
    """decimate() reduces vertex count on a dense mesh."""
    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=1)
    obj = bpy.context.active_object
    verts_before = len(obj.data.vertices)

    worker.decimate(0.25)
    verts_after = len(obj.data.vertices)
    assert verts_after < verts_before, \
        f"Verts not reduced: {verts_before} -> {verts_after}"


def test_decimate_ratio_1_is_noop():
    """decimate(1.0) doesn't reduce vertex count."""
    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.ops.mesh.primitive_cube_add(size=2)
    obj = bpy.context.active_object
    verts_before = len(obj.data.vertices)

    worker.decimate(1.0)
    verts_after = len(obj.data.vertices)
    assert verts_after == verts_before, \
        f"Verts changed at ratio 1.0: {verts_before} -> {verts_after}"


def test_export_unknown_format_falls_back_to_glb():
    """Unknown extension falls back to GLB."""
    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.ops.mesh.primitive_cube_add(size=2)

    with tempfile.NamedTemporaryFile(suffix=".xyz", delete=False) as f:
        xyz_path = f.name
    glb_fallback = os.path.splitext(xyz_path)[0] + ".glb"
    try:
        worker.export_model(xyz_path)
        assert os.path.isfile(glb_fallback), "Fallback GLB not created"
    finally:
        if os.path.isfile(glb_fallback):
            os.unlink(glb_fallback)
        if os.path.isfile(xyz_path):
            os.unlink(xyz_path)


def test_full_pipeline_glb():
    """End-to-end: load -> decimate -> export GLB."""
    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=1)

    with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as f:
        src_path = f.name
    with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as f:
        out_path = f.name
    try:
        worker.export_model(src_path)
        src_size = os.path.getsize(src_path)

        worker.load_model(src_path)
        worker.decimate(0.25)
        worker.export_model(out_path)

        out_size = os.path.getsize(out_path)
        assert out_size > 0, "Output empty"
        assert out_size < src_size, \
            f"Decimated file not smaller: {src_size} -> {out_size}"
    finally:
        os.unlink(src_path)
        os.unlink(out_path)


def test_usd_export():
    """USD export works on Blender 4.x."""
    if not worker.USD_AVAILABLE:
        print("    (skipped — USD not available)")
        return
    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.ops.mesh.primitive_cube_add(size=2)

    with tempfile.NamedTemporaryFile(suffix=".usdc", delete=False) as f:
        usd_path = f.name
    try:
        worker.export_model(usd_path)
        assert os.path.isfile(usd_path), "USD not created"
        assert os.path.getsize(usd_path) > 0, "USD is empty"
    finally:
        os.unlink(usd_path)


def test_preserves_multiple_objects():
    """Pipeline preserves object count with multiple meshes."""
    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 0))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=(3, 0, 0))
    bpy.ops.mesh.primitive_cone_add(radius1=1, depth=2, location=(6, 0, 0))
    count_before = count_meshes()
    assert count_before == 3

    worker.decimate(0.5)
    count_after = count_meshes()
    assert count_after == count_before, \
        f"Object count changed: {count_before} -> {count_after}"


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def main():
    print("\n" + "=" * 60)
    print("WOS 2 Blender Worker Tests")
    print("=" * 60)

    tests = [
        ("clear_scene", test_clear_scene),
        ("load_and_export_glb", test_load_and_export_glb),
        ("load_and_export_obj", test_load_and_export_obj),
        ("load_and_export_fbx", test_load_and_export_fbx),
        ("decimate_reduces_verts", test_decimate_reduces_verts),
        ("decimate_ratio_1_is_noop", test_decimate_ratio_1_is_noop),
        ("export_unknown_format_falls_back_to_glb", test_export_unknown_format_falls_back_to_glb),
        ("full_pipeline_glb", test_full_pipeline_glb),
        ("usd_export", test_usd_export),
        ("preserves_multiple_objects", test_preserves_multiple_objects),
    ]

    for name, fn in tests:
        run_test(name, fn)

    print("\n" + "-" * 60)
    total = _results["passed"] + _results["failed"]
    print(f"Results: {_results['passed']}/{total} passed, {_results['failed']} failed")
    if _results["errors"]:
        print("\nFailures:")
        for name, err in _results["errors"]:
            print(f"  {name}: {err}")
    print("=" * 60 + "\n")

    if _results["failed"] > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
