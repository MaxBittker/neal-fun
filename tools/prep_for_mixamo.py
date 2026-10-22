# Decimate the scan and export a textured FBX for Mixamo's auto-rigger.
# blender -b --python tools/prep_for_mixamo.py -- <in.glb> <texture.jpg> <out.fbx> [target_tris]
import sys
import bmesh
import bpy

args = sys.argv[sys.argv.index("--") + 1:]
src, tex_path, out = args[:3]
target = int(args[3]) if len(args) > 3 else 60000

bpy.ops.wm.read_factory_settings(use_empty=True)
# glTF splits vertices along UV seams, which leaves the scan as ~14k separate
# shells and makes Mixamo's rigger fail. merge_vertices welds them back.
bpy.ops.import_scene.gltf(filepath=src, merge_vertices=True)

obj = next(o for o in bpy.context.scene.objects if o.type == "MESH")
bpy.context.view_layer.objects.active = obj
obj.select_set(True)

# Drop stray floating bits from the scan, keeping only the main body shell.
bm = bmesh.new()
bm.from_mesh(obj.data)
islands, seen = [], set()
for v in bm.verts:
    if v in seen:
        continue
    island, stack = [], [v]
    seen.add(v)
    while stack:
        x = stack.pop()
        island.append(x)
        for e in x.link_edges:
            o = e.other_vert(x)
            if o not in seen:
                seen.add(o)
                stack.append(o)
    islands.append(island)
islands.sort(key=len, reverse=True)
for island in islands[1:]:
    bmesh.ops.delete(bm, geom=island, context="VERTS")
bm.to_mesh(obj.data)
bm.free()
print(f"kept 1 of {len(islands)} shells, sizes {[len(i) for i in islands]}")

# Bake the mm->m scale into the mesh so Mixamo sees a 1.67 m person.
obj.scale = (0.001, 0.001, 0.001)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

tris = len(obj.data.polygons)
mod = obj.modifiers.new("decimate", "DECIMATE")
mod.ratio = min(1.0, target / tris)
bpy.ops.object.modifier_apply(modifier=mod.name)
print(f"decimated {tris} -> {len(obj.data.polygons)} faces")

# Simple textured material so the FBX carries the texture.
mat = bpy.data.materials.new("neal")
mat.use_nodes = True
nodes = mat.node_tree.nodes
img = nodes.new("ShaderNodeTexImage")
img.image = bpy.data.images.load(tex_path)
bsdf = nodes["Principled BSDF"]
mat.node_tree.links.new(img.outputs["Color"], bsdf.inputs["Base Color"])
obj.data.materials.clear()
obj.data.materials.append(mat)

bpy.ops.export_scene.fbx(
    filepath=out,
    use_selection=True,
    path_mode="COPY",
    embed_textures=True,
    apply_unit_scale=True,
)
