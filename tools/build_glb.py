# Merge the Mixamo-rigged character and animation FBXs into one GLB.
# blender -b --python tools/build_glb.py -- <mixamo_dir> <sources_dir> <texture> <out.glb>
# Expects <mixamo_dir>/neal_rigged.fbx plus one <name>.fbx per animation
# (downloaded "without skin"); each becomes a clip called <name>.
# <sources_dir>/floss_biped.fbx (a 3ds Max biped rig) is retargeted to "floss".
import os
import sys
import bmesh
import bpy
import numpy as np
from mathutils import Matrix

args = sys.argv[sys.argv.index("--") + 1:]
src_dir, sources_dir, texture_path, out = args[:4]

bpy.ops.wm.read_factory_settings(use_empty=True)


def import_fbx(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def remove_objects(objs):
    for o in objs:
        action = o.animation_data and o.animation_data.action
        bpy.data.objects.remove(o, do_unlink=True)
        if action and action.users == 0:
            bpy.data.actions.remove(action)


char_objs = import_fbx(os.path.join(src_dir, "neal_rigged.fbx"))
rig = next(o for o in char_objs if o.type == "ARMATURE")
rig.name = "neal"
if rig.animation_data is None:
    rig.animation_data_create()
rig.animation_data.action = None

# The scan has open holes under the shoes. Cap them using only the existing
# rim vertices (so skin weights are untouched), borrowing UVs from the rim.
mesh = next(o for o in char_objs if o.type == "MESH").data
bm = bmesh.new()
bm.from_mesh(mesh)
uv = bm.loops.layers.uv.active
rim_uv = {v: v.link_loops[0][uv].uv.copy() for v in bm.verts if v.link_loops}
rims, seen = [], set()
for e in bm.edges:
    if not e.is_boundary or e in seen:
        continue
    rim, stack = [], [e]
    seen.add(e)
    while stack:
        x = stack.pop()
        rim.append(x)
        for v in x.verts:
            for e2 in v.link_edges:
                if e2.is_boundary and e2 not in seen:
                    seen.add(e2)
                    stack.append(e2)
    rims.append(rim)
filled = [f for rim in rims for f in bmesh.ops.contextual_create(bm, geom=rim)["faces"]]
caps = bmesh.ops.triangulate(bm, faces=filled, quad_method="BEAUTY", ngon_method="BEAUTY")["faces"]

# Rim UVs jump between texture islands, so interpolating them smears colours
# across the cap. Instead paint each cap one flat colour: the darkest rim
# texel (the rubber sole).
tex = bpy.data.images.load(texture_path)
w, h = tex.size
pixels = np.empty(w * h * 4, dtype=np.float32)
tex.pixels.foreach_get(pixels)
pixels = pixels.reshape(h, w, 4)


def brightness(co):
    x = min(w - 1, max(0, int(co.x * w)))
    y = min(h - 1, max(0, int(co.y * h)))
    return pixels[y, x, :3].sum()


darkest = min((rim_uv[v] for f in caps for v in f.verts), key=brightness)
for f in caps:
    for loop in f.loops:
        loop[uv].uv = darkest
bm.to_mesh(mesh)
bm.free()
print(f"capped {len(filled)} holes with {len(caps)} triangles")

# The character's rest pose is the scan's A-pose, but the animation files are
# relative to a T-pose rest, so their actions can't be copied over as-is.
# Instead, make every bone follow its twin in world space and bake that.
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="POSE")
for pb in rig.pose.bones:
    c = pb.constraints.new("COPY_TRANSFORMS")
    c.subtarget = pb.name
bpy.ops.object.mode_set(mode="OBJECT")


def add_clip(name, anim_rig, start, end):
    """Bake `rig` following `anim_rig` (a Mixamo skeleton) into clip `name`."""
    for pb in rig.pose.bones:
        pb.constraints[0].target = anim_rig
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    rig.animation_data.action = None
    bpy.ops.nla.bake(frame_start=start, frame_end=end, only_selected=False,
                     visual_keying=True, clear_constraints=False, use_current_action=False,
                     bake_types={"POSE"})
    action = rig.animation_data.action
    action.name = name
    action.use_fake_user = True
    rig.animation_data.action = None
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, start, action)
    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"added clip {name}: frames {start}-{end}")


names = sorted(f[:-4] for f in os.listdir(src_dir) if f.endswith(".fbx") and f != "neal_rigged.fbx")
for name in names:
    objs = import_fbx(os.path.join(src_dir, name + ".fbx"))
    anim_rig = next(o for o in objs if o.type == "ARMATURE")
    start, end = (int(f) for f in anim_rig.animation_data.action.frame_range)
    add_clip(name, anim_rig, start, end)
    remove_objects(objs)


# --- floss: retarget from a 3ds Max biped ------------------------------------
# Both skeletons rest in a T-pose, so each Mixamo bone copies its biped twin's
# world-space rotation *relative to rest*. Unlisted bones just follow parents.
BIPED_TO_MIXAMO = [
    ("bip Pelvis", "mixamorig:Hips"),
    ("bip Spine", "mixamorig:Spine"),
    ("bip Spine1", "mixamorig:Spine2"),
    ("bip Neck", "mixamorig:Neck"),
    ("bip Head", "mixamorig:Head"),
    ("bip L Clavicle", "mixamorig:LeftShoulder"),
    ("bip L UpperArm", "mixamorig:LeftArm"),
    ("bip L Forearm", "mixamorig:LeftForeArm"),
    ("bip L Hand", "mixamorig:LeftHand"),
    ("bip R Clavicle", "mixamorig:RightShoulder"),
    ("bip R UpperArm", "mixamorig:RightArm"),
    ("bip R Forearm", "mixamorig:RightForeArm"),
    ("bip R Hand", "mixamorig:RightHand"),
    ("bip L Thigh", "mixamorig:LeftUpLeg"),
    ("bip L Calf", "mixamorig:LeftLeg"),
    ("bip L Foot", "mixamorig:LeftFoot"),
    ("bip L Toe0", "mixamorig:LeftToeBase"),
    ("bip R Thigh", "mixamorig:RightUpLeg"),
    ("bip R Calf", "mixamorig:RightLeg"),
    ("bip R Foot", "mixamorig:RightFoot"),
    ("bip R Toe0", "mixamorig:RightToeBase"),
]


def world_rest(arm, bone):
    return arm.matrix_world @ arm.data.bones[bone].matrix_local


def retarget_biped(name, biped_path):
    # Any Mixamo animation file carries Neal's skeleton in a T-pose rest.
    tpose_objs = import_fbx(os.path.join(src_dir, names[0] + ".fbx"))
    tpose = next(o for o in tpose_objs if o.type == "ARMATURE")
    tpose.animation_data.action = None
    biped_objs = import_fbx(biped_path)
    biped = next(o for o in biped_objs if o.type == "ARMATURE")
    start, end = (int(f) for f in biped.animation_data.action.frame_range)

    rest = {m: (world_rest(biped, b).to_quaternion(), world_rest(tpose, m).to_quaternion())
            for b, m in BIPED_TO_MIXAMO}
    hips_rest = world_rest(tpose, "mixamorig:Hips").translation
    pelvis_rest = world_rest(biped, "bip Pelvis").translation
    hip_scale = hips_rest.z / pelvis_rest.z
    to_arm = tpose.matrix_world.inverted()
    to_arm_rot = tpose.matrix_world.to_quaternion().inverted()

    for pb in tpose.pose.bones:
        pb.rotation_mode = "QUATERNION"
    scene = bpy.context.scene
    for frame in range(start, end + 1):
        scene.frame_set(frame)
        for b, m in BIPED_TO_MIXAMO:
            src = biped.matrix_world @ biped.pose.bones[b].matrix
            b_rest, m_rest = rest[m]
            rot = src.to_quaternion() @ b_rest.inverted() @ m_rest
            pb = tpose.pose.bones[m]
            if m == "mixamorig:Hips":
                loc = to_arm @ (hips_rest + (src.translation - pelvis_rest) * hip_scale)
            else:
                loc = pb.matrix.translation.copy()
            pb.matrix = Matrix.LocRotScale(loc, to_arm_rot @ rot, None)
            bpy.context.view_layer.update()
            pb.keyframe_insert("rotation_quaternion", frame=frame)
            if m == "mixamorig:Hips":
                pb.keyframe_insert("location", frame=frame)

    add_clip(name, tpose, start, end)
    remove_objects(biped_objs + tpose_objs)


floss_path = os.path.join(sources_dir, "floss_biped.fbx")
if os.path.exists(floss_path):
    retarget_biped("floss", floss_path)

for pb in rig.pose.bones:
    pb.constraints.remove(pb.constraints[0])

bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    export_animation_mode="NLA_TRACKS",
    export_materials="NONE",
    export_draco_mesh_compression_enable=True,
)
