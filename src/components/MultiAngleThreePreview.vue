<template>
  <div
    ref="containerRef"
    class="multi-angle-three-preview"
    :class="modelValue.target === 'camera' ? 'multi-angle-three-preview--pov' : ''"
    @contextmenu.prevent
  />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as THREE from "three";

interface MultiAngleValue {
  target: "subject" | "camera";
  rotation: number;
  tilt: number;
  zoom: number;
}

type DragTarget = "azimuth" | "elevation" | "distance" | null;

const props = defineProps<{
  modelValue: MultiAngleValue;
  imageUrl?: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: MultiAngleValue];
}>();

const containerRef = ref<HTMLElement | null>(null);
let widget: MultiAngleThreeWidget | null = null;

function emitValue(value: MultiAngleValue) {
  emit("update:modelValue", value);
}

onMounted(() => {
  if (!containerRef.value) {
    return;
  }

  widget = new MultiAngleThreeWidget(containerRef.value, emitValue);
  widget.setState(props.modelValue);
  widget.updateImage(props.imageUrl || null);
});

watch(
  () => props.modelValue,
  (value) => {
    widget?.setState(value);
  },
  { deep: true },
);

watch(
  () => props.imageUrl,
  (imageUrl) => {
    widget?.updateImage(imageUrl || null);
  },
);

onBeforeUnmount(() => {
  widget?.dispose();
  widget = null;
});

class MultiAngleThreeWidget {
  private readonly center = new THREE.Vector3(0, 0.78, 0);
  private readonly azimuthRadius = 1.9;
  private readonly elevationRadius = 1.42;
  private readonly elevationArcX = -1.05;
  private readonly elevationMin = -30;
  private readonly elevationMax = 60;
  private readonly zoomMin = 1;
  private readonly zoomMax = 8;
  private readonly defaultZoom = 5;
  private readonly freeViewImageHeightRatio = 0.75;
  private readonly subjectMaxWidth = 1.42;
  private readonly subjectMaxHeight = 1.58;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
  private readonly povCamera = new THREE.PerspectiveCamera(74, 1, 0.1, 100);
  private activeCamera: THREE.Camera = this.camera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly raycaster = new THREE.Raycaster();
  private readonly mouse = new THREE.Vector2();
  private readonly resizeObserver: ResizeObserver;

  private state: MultiAngleValue = {
    target: "subject",
    rotation: 0,
    tilt: 0,
    zoom: 5,
  };

  private animationId = 0;
  private dragTarget: DragTarget = null;
  private draggingPov = false;
  private povStartX = 0;
  private povStartY = 0;
  private povStartRotation = 0;
  private povStartTilt = 0;
  private hoverTarget: DragTarget = null;

  private readonly subjectMaterial = new THREE.MeshBasicMaterial({
    color: 0xf8fafc,
    side: THREE.DoubleSide,
  });
  private readonly subjectSideMaterial = new THREE.MeshBasicMaterial({
    color: 0x162033,
  });
  private readonly subjectMesh: THREE.Mesh;
  private readonly subjectFrame: THREE.LineSegments;
  private subjectTexture: THREE.Texture | null = null;

  private readonly cameraRig = new THREE.Group();
  private readonly azimuthRing: THREE.Mesh;
  private readonly elevationArc: THREE.Mesh;
  private readonly distanceTube: THREE.Mesh;
  private readonly azimuthHandle: THREE.Mesh;
  private readonly elevationHandle: THREE.Mesh;
  private readonly distanceHandle: THREE.Mesh;
  private readonly azimuthGlow: THREE.Mesh;
  private readonly elevationGlow: THREE.Mesh;
  private readonly distanceGlow: THREE.Mesh;
  private readonly focusRing: THREE.Mesh;

  constructor(
    private readonly container: HTMLElement,
    private readonly onChange: (value: MultiAngleValue) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setClearColor(0x070c16, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = "multi-angle-three-preview__canvas";
    Object.assign(this.renderer.domElement.style, {
      position: "absolute",
      inset: "0",
      display: "block",
      width: "100%",
      height: "100%",
    });
    this.container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x070c16);
    this.camera.position.set(4.1, 3.15, 4.75);
    this.camera.zoom = 1.36;
    this.camera.lookAt(this.center);
    this.camera.updateProjectionMatrix();

    this.scene.add(new THREE.AmbientLight(0xb8c7dd, 0.46));
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.92);
    keyLight.position.set(4, 7, 5);
    this.scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x7dd3fc, 0.28);
    fillLight.position.set(-4, 4, -2);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xf0abfc, 0.16);
    rimLight.position.set(-5, 5, -5);
    this.scene.add(rimLight);

    const grid = new THREE.GridHelper(5.4, 24, 0x475569, 0x1e293b);
    grid.position.y = 0;
    this.scene.add(grid);

    const subjectGeometry = new THREE.BoxGeometry(1, 1, 0.035);
    this.subjectMesh = new THREE.Mesh(subjectGeometry, [
      this.subjectSideMaterial,
      this.subjectSideMaterial,
      this.subjectSideMaterial,
      this.subjectSideMaterial,
      this.subjectMaterial,
      this.subjectMaterial,
    ]);
    this.subjectMesh.position.copy(this.center);
    this.subjectMesh.scale.set(1.22, 1.56, 1);
    this.scene.add(this.subjectMesh);

    this.subjectFrame = new THREE.LineSegments(
      new THREE.EdgesGeometry(subjectGeometry),
      new THREE.LineBasicMaterial({ color: 0xe2e8f0, transparent: true, opacity: 0.72 }),
    );
    this.subjectFrame.position.copy(this.center);
    this.subjectFrame.scale.copy(this.subjectMesh.scale);
    this.scene.add(this.subjectFrame);

    this.focusRing = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.575, 80),
      new THREE.MeshBasicMaterial({
        color: 0xff3344,
        transparent: true,
        opacity: 0.36,
        side: THREE.DoubleSide,
      }),
    );
    this.focusRing.rotation.x = -Math.PI / 2;
    this.focusRing.position.set(0, 0.025, 0);
    this.scene.add(this.focusRing);

    this.azimuthRing = this.createAzimuthRing();
    this.scene.add(this.azimuthRing);

    this.elevationArc = this.createElevationArc();
    this.scene.add(this.elevationArc);

    this.distanceTube = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.LineCurve3(this.center, this.center), 1, 0.022, 8),
      new THREE.MeshBasicMaterial({ color: 0xf5a400, transparent: true, opacity: 0.86 }),
    );
    this.scene.add(this.distanceTube);

    this.azimuthHandle = this.createHandle(0xff5964);
    this.elevationHandle = this.createHandle(0x55ff72);
    this.distanceHandle = this.createHandle(0xffb928);
    this.azimuthGlow = this.createGlow(0xff5964);
    this.elevationGlow = this.createGlow(0x55ff72);
    this.distanceGlow = this.createGlow(0xffb928);
    this.scene.add(
      this.azimuthGlow,
      this.elevationGlow,
      this.distanceGlow,
      this.azimuthHandle,
      this.elevationHandle,
      this.distanceHandle,
    );

    this.createCameraRig();
    this.scene.add(this.cameraRig);

    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.updateVisuals();
    this.animate();
  }

  public setState(next: MultiAngleValue): void {
    this.state = {
      target: next.target,
      rotation: this.normalizeDegrees(next.rotation),
      tilt: this.clamp(next.tilt, this.elevationMin, this.elevationMax),
      zoom: this.clamp(next.zoom, this.zoomMin, this.zoomMax),
    };
    this.applyMode();
    this.updateVisuals();
  }

  public updateImage(url: string | null): void {
    if (this.subjectTexture) {
      this.subjectTexture.dispose();
      this.subjectTexture = null;
    }

    if (!url) {
      this.subjectMaterial.map = this.createPlaceholderTexture();
      this.subjectMaterial.color.set(0xffffff);
      this.subjectMaterial.needsUpdate = true;
      this.setSubjectSize(1.22, 1.56);
      return;
    }

    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      url,
      (texture) => {
        this.subjectTexture = texture;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        this.subjectMaterial.map = texture;
        this.subjectMaterial.color.set(0xffffff);
        this.subjectMaterial.needsUpdate = true;

        const image = texture.image as HTMLImageElement | HTMLCanvasElement | undefined;
        const aspect = image && image.height ? image.width / image.height : 1;
        if (aspect >= this.subjectMaxWidth / this.subjectMaxHeight) {
          this.setSubjectSize(this.subjectMaxWidth, this.subjectMaxWidth / aspect);
        } else {
          this.setSubjectSize(this.subjectMaxHeight * aspect, this.subjectMaxHeight);
        }
      },
      undefined,
      () => {
        this.subjectMaterial.map = this.createPlaceholderTexture();
        this.subjectMaterial.needsUpdate = true;
        this.setSubjectSize(1.22, 1.56);
      },
    );
  }

  public dispose(): void {
    cancelAnimationFrame(this.animationId);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.handlePointerDown);
    canvas.removeEventListener("pointermove", this.handlePointerMove);
    window.removeEventListener("pointermove", this.handlePointerMove);
    window.removeEventListener("pointerup", this.handlePointerUp);
    canvas.removeEventListener("wheel", this.handleWheel);

    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if ("map" in material && material.map instanceof THREE.Texture) {
            material.map.dispose();
          }
          material.dispose();
        }
      }
    });
    this.renderer.dispose();
    canvas.remove();
  }

  private createAzimuthRing(): THREE.Mesh {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(this.azimuthRadius, 0.028, 12, 160),
      new THREE.MeshBasicMaterial({
        color: 0xff3344,
        transparent: true,
        opacity: 0.9,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.045;
    return ring;
  }

  private setSubjectSize(width: number, height: number): void {
    this.center.set(0, height / 2, 0);
    this.subjectMesh.position.copy(this.center);
    this.subjectMesh.scale.set(width, height, 1);
    this.subjectFrame.position.copy(this.center);
    this.subjectFrame.scale.copy(this.subjectMesh.scale);
    this.updateElevationArcGeometry();
    this.updateCameraFraming();
    this.updateVisuals();
  }

  private updateCameraFraming(): void {
    const defaultDistance = this.getVisualCameraDistance(this.defaultZoom);
    const subjectHeight = Math.max(this.subjectMesh.scale.y, 0.1);
    const fovRadians = 2 * Math.atan(subjectHeight / (2 * this.freeViewImageHeightRatio * defaultDistance));
    this.povCamera.fov = this.clamp(THREE.MathUtils.radToDeg(fovRadians), 32, 82);
    this.povCamera.updateProjectionMatrix();
    this.camera.lookAt(this.center);
  }

  private createElevationArc(): THREE.Mesh {
    return new THREE.Mesh(
      this.createElevationArcGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0x28ff39,
        transparent: true,
        opacity: 0.94,
      }),
    );
  }

  private createElevationArcGeometry(): THREE.TubeGeometry {
    const points: THREE.Vector3[] = [];
    for (let index = 0; index <= 48; index += 1) {
      const angle = THREE.MathUtils.degToRad(
        this.elevationMin + ((this.elevationMax - this.elevationMin) * index) / 48,
      );
      points.push(
        new THREE.Vector3(
          this.elevationArcX,
          this.center.y + this.elevationRadius * Math.sin(angle),
          this.elevationRadius * Math.cos(angle),
        ),
      );
    }

    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 72, 0.03, 10, false);
  }

  private updateElevationArcGeometry(): void {
    this.elevationArc.geometry.dispose();
    this.elevationArc.geometry = this.createElevationArcGeometry();
  }

  private createHandle(color: number): THREE.Mesh {
    return new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 32, 32),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.34,
        metalness: 0.08,
        roughness: 0.44,
        transparent: true,
        opacity: 0.72,
      }),
    );
  }

  private createGlow(color: number): THREE.Mesh {
    return new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 24, 24),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
      }),
    );
  }

  private createCameraRig(): void {
    const bodyMaterial = new THREE.MeshBasicMaterial({
      color: 0xf1f5f9,
    });
    const detailMaterial = new THREE.MeshBasicMaterial({
      color: 0xcbd5e1,
    });
    const glassMaterial = new THREE.MeshBasicMaterial({
      color: 0x60a5fa,
    });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.28), bodyMaterial);
    const prism = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.18), detailMaterial);
    prism.position.set(-0.08, 0.22, 0);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.25, 0.24), detailMaterial);
    grip.position.set(0.27, -0.02, 0.02);

    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.22, 32), glassMaterial);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 0, -0.24);

    const lensRim = new THREE.Mesh(
      new THREE.TorusGeometry(0.16, 0.018, 8, 32),
      new THREE.MeshBasicMaterial({
        color: 0xf8fafc,
      }),
    );
    lensRim.position.set(0, 0, -0.36);

    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.035, 0.035), detailMaterial);
    strap.position.set(0, -0.2, 0.02);

    this.cameraRig.add(body, prism, grip, lens, lensRim, strap);
    this.cameraRig.scale.setScalar(0.92);
  }

  private bindEvents(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointermove", this.handlePointerMove);
    window.addEventListener("pointermove", this.handlePointerMove);
    window.addEventListener("pointerup", this.handlePointerUp);
    canvas.addEventListener("wheel", this.handleWheel, { passive: false });
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.updateMouse(event);

    if (this.state.target === "camera") {
      this.draggingPov = true;
      this.povStartX = event.clientX;
      this.povStartY = event.clientY;
      this.povStartRotation = this.state.rotation;
      this.povStartTilt = this.state.tilt;
      this.renderer.domElement.style.cursor = "grabbing";
      return;
    }

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hit = this.getHitHandle();
    if (!hit) {
      return;
    }

    this.dragTarget = hit;
    this.setHandleScale(hit, 1.22);
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.renderer.domElement.style.cursor = "grabbing";
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    this.updateMouse(event);

    if (this.draggingPov) {
      const nextRotation = this.normalizeDegrees(this.povStartRotation - (event.clientX - this.povStartX) * 0.5);
      const nextTilt = this.clamp(
        this.povStartTilt + (event.clientY - this.povStartY) * 0.42,
        this.elevationMin,
        this.elevationMax,
      );
      this.updateState({ rotation: Math.round(nextRotation), tilt: Math.round(nextTilt) });
      return;
    }

    if (this.dragTarget) {
      this.updateDragTarget();
      return;
    }

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hit = this.getHitHandle();
    this.setHoverTarget(hit);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) {
      this.renderer.domElement.releasePointerCapture(event.pointerId);
    }

    this.draggingPov = false;
    this.dragTarget = null;
    this.setHandleScale("azimuth", 1);
    this.setHandleScale("elevation", 1);
    this.setHandleScale("distance", 1);
    this.renderer.domElement.style.cursor = this.state.target === "camera" ? "grab" : "default";
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    if (this.state.target !== "camera") {
      return;
    }

    event.preventDefault();
    this.updateState({
      zoom: this.roundToTenth(this.clamp(this.state.zoom - event.deltaY * 0.012, this.zoomMin, this.zoomMax)),
    });
  };

  private updateDragTarget(): void {
    this.raycaster.setFromCamera(this.mouse, this.camera);

    if (this.dragTarget === "azimuth") {
      const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const hit = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(groundPlane, hit)) {
        this.updateState({
          rotation: Math.round(this.normalizeDegrees(THREE.MathUtils.radToDeg(Math.atan2(hit.x, hit.z)))),
        });
      }
      return;
    }

    if (this.dragTarget === "elevation") {
      const elevationPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), -this.elevationArcX);
      const hit = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(elevationPlane, hit)) {
        const angle = THREE.MathUtils.radToDeg(Math.atan2(hit.y - this.center.y, hit.z));
        this.updateState({ tilt: Math.round(this.clamp(angle, this.elevationMin, this.elevationMax)) });
      }
      return;
    }

    const centerProjected = this.center.clone().project(this.camera);
    const cameraProjected = this.cameraRig.position.clone().project(this.camera);
    const line = new THREE.Vector2(
      cameraProjected.x - centerProjected.x,
      cameraProjected.y - centerProjected.y,
    );
    const point = new THREE.Vector2(this.mouse.x - centerProjected.x, this.mouse.y - centerProjected.y);
    const lineLengthSq = line.lengthSq();
    if (lineLengthSq <= 0.0001) {
      return;
    }

    const t = this.clamp(point.dot(line) / lineLengthSq, 0.15, 0.85);
    const normalized = (t - 0.15) / 0.7;
    this.updateState({
      zoom: this.roundToTenth(this.zoomMax - normalized * (this.zoomMax - this.zoomMin)),
    });
  }

  private updateMouse(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private getHitHandle(): DragTarget {
    const handles: Array<[DragTarget, THREE.Mesh]> = [
      ["azimuth", this.azimuthHandle],
      ["elevation", this.elevationHandle],
      ["distance", this.distanceHandle],
    ];

    for (const [name, handle] of handles) {
      if (this.raycaster.intersectObject(handle, false).length > 0) {
        return name;
      }
    }
    return null;
  }

  private setHoverTarget(target: DragTarget): void {
    if (target === this.hoverTarget) {
      return;
    }

    if (this.hoverTarget) {
      this.setHandleScale(this.hoverTarget, 1);
    }
    if (target) {
      this.setHandleScale(target, 1.12);
    }

    this.hoverTarget = target;
    this.renderer.domElement.style.cursor = target ? "grab" : "default";
  }

  private setHandleScale(target: Exclude<DragTarget, null>, scale: number): void {
    const pairs = {
      azimuth: [this.azimuthHandle, this.azimuthGlow],
      elevation: [this.elevationHandle, this.elevationGlow],
      distance: [this.distanceHandle, this.distanceGlow],
    } satisfies Record<Exclude<DragTarget, null>, [THREE.Mesh, THREE.Mesh]>;
    const [handle, glow] = pairs[target];
    handle.scale.setScalar(scale);
    glow.scale.setScalar(scale);
  }

  private updateState(next: Partial<MultiAngleValue>): void {
    this.state = {
      ...this.state,
      ...next,
      rotation: this.normalizeDegrees(next.rotation ?? this.state.rotation),
      tilt: this.clamp(next.tilt ?? this.state.tilt, this.elevationMin, this.elevationMax),
      zoom: this.clamp(next.zoom ?? this.state.zoom, this.zoomMin, this.zoomMax),
    };
    this.updateVisuals();
    this.onChange({
      target: this.state.target,
      rotation: Math.round(this.state.rotation),
      tilt: Math.round(this.state.tilt),
      zoom: this.roundToTenth(this.state.zoom),
    });
  }

  private updateVisuals(): void {
    const azimuthRadians = THREE.MathUtils.degToRad(this.state.rotation);
    const elevationRadians = THREE.MathUtils.degToRad(this.state.tilt);
    const cameraDistance = this.getVisualCameraDistance(this.state.zoom);
    const cameraPosition = new THREE.Vector3(
      cameraDistance * Math.sin(azimuthRadians) * Math.cos(elevationRadians),
      this.center.y + cameraDistance * Math.sin(elevationRadians),
      cameraDistance * Math.cos(azimuthRadians) * Math.cos(elevationRadians),
    );

    this.cameraRig.position.copy(cameraPosition);
    this.cameraRig.lookAt(this.center);

    const azimuthPosition = new THREE.Vector3(
      this.azimuthRadius * Math.sin(azimuthRadians),
      0.045,
      this.azimuthRadius * Math.cos(azimuthRadians),
    );
    this.azimuthHandle.position.copy(azimuthPosition);
    this.azimuthGlow.position.copy(azimuthPosition);

    const elevationPosition = new THREE.Vector3(
      this.elevationArcX,
      this.center.y + this.elevationRadius * Math.sin(elevationRadians),
      this.elevationRadius * Math.cos(elevationRadians),
    );
    this.elevationHandle.position.copy(elevationPosition);
    this.elevationGlow.position.copy(elevationPosition);

    const distanceT = 0.15 + ((this.zoomMax - this.state.zoom) / (this.zoomMax - this.zoomMin)) * 0.7;
    const distancePosition = new THREE.Vector3().lerpVectors(this.center, cameraPosition, distanceT);
    this.distanceHandle.position.copy(distancePosition);
    this.distanceGlow.position.copy(distancePosition);
    this.updateDistanceTube(cameraPosition);

    this.povCamera.position.copy(cameraPosition);
    this.povCamera.lookAt(this.center);
    this.applyMode();
  }

  private updateDistanceTube(cameraPosition: THREE.Vector3): void {
    this.distanceTube.geometry.dispose();
    this.distanceTube.geometry = new THREE.TubeGeometry(
      new THREE.LineCurve3(this.center.clone(), cameraPosition.clone()),
      1,
      0.022,
      8,
      false,
    );
  }

  private applyMode(): void {
    const standardMode = this.state.target === "subject";
    this.activeCamera = standardMode ? this.camera : this.povCamera;
    this.azimuthRing.visible = standardMode;
    this.elevationArc.visible = standardMode;
    this.distanceTube.visible = standardMode;
    this.azimuthHandle.visible = standardMode;
    this.elevationHandle.visible = standardMode;
    this.distanceHandle.visible = standardMode;
    this.azimuthGlow.visible = standardMode;
    this.elevationGlow.visible = standardMode;
    this.distanceGlow.visible = standardMode;
    this.cameraRig.visible = standardMode;
    this.focusRing.visible = standardMode;
    this.renderer.domElement.style.cursor = standardMode ? "default" : "grab";
  }

  private getVisualCameraDistance(zoom: number): number {
    const progress = (zoom - this.zoomMin) / (this.zoomMax - this.zoomMin);
    return 2.35 - progress * 1.65;
  }

  private resize(): void {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.povCamera.aspect = width / height;
    this.povCamera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);
    this.focusRing.rotation.z += 0.004;
    this.renderer.render(this.scene, this.activeCamera);
  };

  private createPlaceholderTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 640;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#101827";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = "#475569";
      context.lineWidth = 10;
      context.strokeRect(36, 36, canvas.width - 72, canvas.height - 72);
      context.strokeStyle = "#94a3b8";
      context.lineWidth = 12;
      context.beginPath();
      context.rect(184, 210, 144, 132);
      context.stroke();
      context.beginPath();
      context.arc(240, 254, 18, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.moveTo(196, 330);
      context.lineTo(254, 278);
      context.lineTo(318, 342);
      context.stroke();
      context.fillStyle = "#cbd5e1";
      context.font = "600 36px sans-serif";
      context.textAlign = "center";
      context.fillText("参考图", canvas.width / 2, 420);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private normalizeDegrees(degrees: number): number {
    let normalized = degrees;
    while (normalized < 0) {
      normalized += 360;
    }
    while (normalized >= 360) {
      normalized -= 360;
    }
    return normalized;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  private roundToTenth(value: number): number {
    return Math.round(value * 10) / 10;
  }
}
</script>

<style scoped>
.multi-angle-three-preview {
  position: relative;
  width: 100%;
  height: 14.75rem;
  overflow: hidden;
  border-radius: calc(var(--radius) + 2px);
  background: #070c16;
  touch-action: none;
  user-select: none;
}

@media (max-width: 760px) {
  .multi-angle-three-preview {
    height: 12rem;
  }
}
</style>
