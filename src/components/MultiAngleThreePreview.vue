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

type ThemeMode = "light" | "dark";
type DragTarget = "azimuth" | "elevation" | "distance" | null;

interface PreviewTheme {
  background: number;
  gridMajor: number;
  gridMinor: number;
  subjectFace: number;
  subjectSide: number;
  subjectFrame: number;
  focus: number;
  elevation: number;
  distance: number;
  azimuthHandle: number;
  elevationHandle: number;
  distanceHandle: number;
  cameraBody: number;
  cameraDetail: number;
  cameraGlass: number;
  cameraRim: number;
  ambient: number;
  key: number;
  fill: number;
  rim: number;
  placeholderBg: string;
  placeholderBorder: string;
  placeholderInk: string;
  placeholderText: string;
}

const props = defineProps<{
  modelValue: MultiAngleValue;
  imageUrl?: string;
  themeMode?: ThemeMode;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: MultiAngleValue];
}>();

const containerRef = ref<HTMLElement | null>(null);
let widget: MultiAngleThreeWidget | null = null;

function emitValue(value: MultiAngleValue) {
  emit("update:modelValue", value);
}

function resolveThemeMode(): ThemeMode {
  return props.themeMode || (document.documentElement.classList.contains("dark") ? "dark" : "light");
}

onMounted(() => {
  if (!containerRef.value) {
    return;
  }

  widget = new MultiAngleThreeWidget(containerRef.value, emitValue, resolveThemeMode());
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

watch(
  () => props.themeMode,
  () => {
    widget?.setTheme(resolveThemeMode());
  },
);

onBeforeUnmount(() => {
  widget?.dispose();
  widget = null;
});

const PREVIEW_THEMES = {
  light: {
    background: 0xf5f8ff,
    gridMajor: 0xaebbe0,
    gridMinor: 0xdfe6f7,
    subjectFace: 0xffffff,
    subjectSide: 0xcbd6f4,
    subjectFrame: 0x3757a6,
    focus: 0x4c8dff,
    elevation: 0xa86cff,
    distance: 0x22c6d9,
    azimuthHandle: 0x4c8dff,
    elevationHandle: 0xa86cff,
    distanceHandle: 0x22c6d9,
    cameraBody: 0x172033,
    cameraDetail: 0x2a3858,
    cameraGlass: 0x4c8dff,
    cameraRim: 0x0c1220,
    ambient: 0xe8efff,
    key: 0xffffff,
    fill: 0xbfd7ff,
    rim: 0xe7d6ff,
    placeholderBg: "#f5f8ff",
    placeholderBorder: "#aebbe0",
    placeholderInk: "#3757a6",
    placeholderText: "#172033",
  },
  dark: {
    background: 0x080d1d,
    gridMajor: 0x385483,
    gridMinor: 0x16213d,
    subjectFace: 0xf2f5f8,
    subjectSide: 0x18233d,
    subjectFrame: 0xbfd7ff,
    focus: 0x74a7ff,
    elevation: 0xbb86ff,
    distance: 0x35d2e6,
    azimuthHandle: 0x74a7ff,
    elevationHandle: 0xbb86ff,
    distanceHandle: 0x35d2e6,
    cameraBody: 0xf0f5ff,
    cameraDetail: 0xbfd1f3,
    cameraGlass: 0x74a7ff,
    cameraRim: 0xffffff,
    ambient: 0xd7deea,
    key: 0xffffff,
    fill: 0x74a7ff,
    rim: 0xbb86ff,
    placeholderBg: "#080d1d",
    placeholderBorder: "#385483",
    placeholderInk: "#8fb4ff",
    placeholderText: "#f0f5ff",
  },
} satisfies Record<ThemeMode, PreviewTheme>;

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
  private readonly gridDivisions = 24;
  private readonly freeViewImageHeightRatio = 0.75;
  private readonly subjectMaxWidth = 1.42;
  private readonly subjectMaxHeight = 1.58;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
  private readonly povCamera = new THREE.PerspectiveCamera(74, 1, 0.1, 100);
  private activeCamera: THREE.Camera = this.camera;
  private themeMode: ThemeMode;
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
  private readonly subjectFrameMaterial = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.72 });
  private readonly subjectFrame: THREE.LineSegments;
  private subjectTexture: THREE.Texture | null = null;
  private usingPlaceholderTexture = false;

  private readonly cameraRig = new THREE.Group();
  private readonly cameraBodyMaterial = new THREE.MeshBasicMaterial();
  private readonly cameraDetailMaterial = new THREE.MeshBasicMaterial();
  private readonly cameraGlassMaterial = new THREE.MeshBasicMaterial();
  private readonly cameraRimMaterial = new THREE.MeshBasicMaterial();
  private readonly ambientLight = new THREE.AmbientLight();
  private readonly keyLight = new THREE.DirectionalLight();
  private readonly fillLight = new THREE.DirectionalLight();
  private readonly rimLight = new THREE.DirectionalLight();
  private readonly grid: THREE.GridHelper;
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
    themeMode: ThemeMode,
  ) {
    this.themeMode = themeMode;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
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

    this.camera.position.set(4.1, 3.15, 4.75);
    this.camera.zoom = 1.36;
    this.camera.lookAt(this.center);
    this.camera.updateProjectionMatrix();

    this.ambientLight.intensity = 0.54;
    this.scene.add(this.ambientLight);
    this.keyLight.intensity = 0.9;
    this.keyLight.position.set(4, 7, 5);
    this.scene.add(this.keyLight);
    this.fillLight.intensity = 0.26;
    this.fillLight.position.set(-4, 4, -2);
    this.scene.add(this.fillLight);
    this.rimLight.intensity = 0.16;
    this.rimLight.position.set(-5, 5, -5);
    this.scene.add(this.rimLight);

    this.grid = new THREE.GridHelper(5.4, this.gridDivisions, 0xffffff, 0xffffff);
    this.grid.position.y = 0;
    this.scene.add(this.grid);

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
      this.subjectFrameMaterial,
    );
    this.subjectFrame.position.copy(this.center);
    this.subjectFrame.scale.copy(this.subjectMesh.scale);
    this.scene.add(this.subjectFrame);

    this.focusRing = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.575, 80),
      new THREE.MeshBasicMaterial({
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
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.86 }),
    );
    this.scene.add(this.distanceTube);

    this.azimuthHandle = this.createHandle();
    this.elevationHandle = this.createHandle();
    this.distanceHandle = this.createHandle();
    this.azimuthGlow = this.createGlow();
    this.elevationGlow = this.createGlow();
    this.distanceGlow = this.createGlow();
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
    this.applyTheme();
    this.updateVisuals();
    this.animate();
  }

  public setTheme(themeMode: ThemeMode): void {
    if (themeMode === this.themeMode) {
      return;
    }

    this.themeMode = themeMode;
    this.applyTheme();
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
      this.usingPlaceholderTexture = true;
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
        this.usingPlaceholderTexture = false;
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
        this.usingPlaceholderTexture = true;
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

  private get theme() {
    return PREVIEW_THEMES[this.themeMode];
  }

  private applyTheme(): void {
    const theme = this.theme;
    this.renderer.setClearColor(theme.background, 1);
    this.scene.background = new THREE.Color(theme.background);
    this.container.style.backgroundColor = `#${theme.background.toString(16).padStart(6, "0")}`;

    this.subjectMaterial.color.set(this.subjectMaterial.map ? 0xffffff : theme.subjectFace);
    this.subjectSideMaterial.color.set(theme.subjectSide);
    this.subjectFrameMaterial.color.set(theme.subjectFrame);
    this.setBasicMaterialColor(this.focusRing, theme.focus);
    this.setBasicMaterialColor(this.azimuthRing, theme.focus);
    this.setBasicMaterialColor(this.elevationArc, theme.elevation);
    this.setBasicMaterialColor(this.distanceTube, theme.distance);
    this.setStandardMaterialColor(this.azimuthHandle, theme.azimuthHandle);
    this.setStandardMaterialColor(this.elevationHandle, theme.elevationHandle);
    this.setStandardMaterialColor(this.distanceHandle, theme.distanceHandle);
    this.setBasicMaterialColor(this.azimuthGlow, theme.azimuthHandle);
    this.setBasicMaterialColor(this.elevationGlow, theme.elevationHandle);
    this.setBasicMaterialColor(this.distanceGlow, theme.distanceHandle);

    this.cameraBodyMaterial.color.set(theme.cameraBody);
    this.cameraDetailMaterial.color.set(theme.cameraDetail);
    this.cameraGlassMaterial.color.set(theme.cameraGlass);
    this.cameraRimMaterial.color.set(theme.cameraRim);
    this.ambientLight.color.set(theme.ambient);
    this.keyLight.color.set(theme.key);
    this.fillLight.color.set(theme.fill);
    this.rimLight.color.set(theme.rim);
    this.applyGridTheme();

    if (this.usingPlaceholderTexture) {
      this.subjectMaterial.map?.dispose();
      this.subjectMaterial.map = this.createPlaceholderTexture();
    }
    this.subjectMaterial.needsUpdate = true;
  }

  private applyGridTheme(): void {
    const material = this.grid.material as THREE.LineBasicMaterial;
    material.color.set(0xffffff);
    material.opacity = this.themeMode === "light" ? 0.58 : 0.66;
    material.transparent = true;
    material.vertexColors = true;
    material.needsUpdate = true;

    const colorAttribute = this.grid.geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
    if (!colorAttribute) {
      return;
    }

    const majorColor = new THREE.Color(this.theme.gridMajor);
    const minorColor = new THREE.Color(this.theme.gridMinor);
    const centerLineIndex = this.gridDivisions / 2;

    for (let lineIndex = 0; lineIndex <= this.gridDivisions; lineIndex += 1) {
      const color = lineIndex === centerLineIndex ? majorColor : minorColor;
      for (let vertexOffset = 0; vertexOffset < 4; vertexOffset += 1) {
        colorAttribute.setXYZ(
          lineIndex * 4 + vertexOffset,
          color.r,
          color.g,
          color.b,
        );
      }
    }
    colorAttribute.needsUpdate = true;
  }

  private setBasicMaterialColor(mesh: THREE.Mesh, color: number): void {
    const material = mesh.material;
    if (material instanceof THREE.MeshBasicMaterial) {
      material.color.set(color);
      material.needsUpdate = true;
    }
  }

  private setStandardMaterialColor(mesh: THREE.Mesh, color: number): void {
    const material = mesh.material;
    if (material instanceof THREE.MeshStandardMaterial) {
      material.color.set(color);
      material.emissive.set(color);
      material.needsUpdate = true;
    }
  }

  private createAzimuthRing(): THREE.Mesh {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(this.azimuthRadius, 0.028, 12, 160),
      new THREE.MeshBasicMaterial({
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

  private createHandle(): THREE.Mesh {
    return new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 32, 32),
      new THREE.MeshStandardMaterial({
        emissiveIntensity: 0.34,
        metalness: 0.08,
        roughness: 0.44,
        transparent: true,
        opacity: 0.72,
      }),
    );
  }

  private createGlow(): THREE.Mesh {
    return new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 24, 24),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
      }),
    );
  }

  private createCameraRig(): void {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.28), this.cameraBodyMaterial);
    const prism = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.18), this.cameraDetailMaterial);
    prism.position.set(-0.08, 0.22, 0);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.25, 0.24), this.cameraDetailMaterial);
    grip.position.set(0.27, -0.02, 0.02);

    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.22, 32), this.cameraGlassMaterial);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 0, -0.24);

    const lensRim = new THREE.Mesh(
      new THREE.TorusGeometry(0.16, 0.018, 8, 32),
      this.cameraRimMaterial,
    );
    lensRim.position.set(0, 0, -0.36);

    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.035, 0.035), this.cameraDetailMaterial);
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
    const theme = this.theme;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 640;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = theme.placeholderBg;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = theme.placeholderBorder;
      context.lineWidth = 10;
      context.strokeRect(36, 36, canvas.width - 72, canvas.height - 72);
      context.strokeStyle = theme.placeholderInk;
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
      context.fillStyle = theme.placeholderText;
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
  background: hsl(var(--preview-background));
  touch-action: none;
  user-select: none;
}

@media (max-width: 760px) {
  .multi-angle-three-preview {
    height: 12rem;
  }
}
</style>
