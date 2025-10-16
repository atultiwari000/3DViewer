"use client";

import React, {
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";

interface SceneProps {
  onTransformChange?: (transform: any) => void;
  onCameraChange?: (camera: any) => void;
}

export interface SceneHandle {
  loadModel: (
    fileDataUrl: string,
    onLoad?: (initialTransform: any) => void
  ) => void;
  clear: () => void;
  applyTransform: (transform: any) => void;
  getTransform: () => any | null;
  applyCameraTransform: (camera: any) => void;
  resetCamera: () => void;
}

const Scene = forwardRef<SceneHandle, SceneProps>(
  ({ onTransformChange, onCameraChange }, ref) => {
    const mountRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef(new THREE.Scene());
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const transformControlsRef = useRef<TransformControls | null>(null);
    const modelRef = useRef<THREE.Group | null>(null);
    const animationFrameIdRef = useRef<number | null>(null);
    const isLoadingRef = useRef<boolean>(false);
    const isSyncingCameraRef = useRef<boolean>(false);

    const handleResize = useCallback(() => {
      if (cameraRef.current && rendererRef.current && mountRef.current) {
        const { clientWidth, clientHeight } = mountRef.current;
        cameraRef.current.aspect = clientWidth / clientHeight;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(clientWidth, clientHeight);
      }
    }, []);

    const removeModel = useCallback(() => {
      if (modelRef.current) {
        console.log("🧹 Removing existing model");

        if (transformControlsRef.current) {
          transformControlsRef.current.detach();
        }

        sceneRef.current.remove(modelRef.current);

        modelRef.current.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry?.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach((mat) => mat.dispose());
            } else {
              child.material?.dispose();
            }
          }
        });

        modelRef.current = null;
      }
    }, []);

    const applyTransformToModel = useCallback((transform: any) => {
      if (modelRef.current && transform) {
        modelRef.current.position.fromArray(transform.position);
        modelRef.current.rotation.set(
          transform.rotation[0],
          transform.rotation[1],
          transform.rotation[2],
          transform.rotation[3] || "XYZ"
        );
        modelRef.current.scale.fromArray(transform.scale);
        modelRef.current.updateMatrix();
        modelRef.current.updateMatrixWorld(true);
      }
    }, []);

    const getModelTransform = useCallback(() => {
      if (!modelRef.current) return null;

      return {
        position: modelRef.current.position.toArray(),
        rotation: [
          modelRef.current.rotation.x,
          modelRef.current.rotation.y,
          modelRef.current.rotation.z,
          modelRef.current.rotation.order,
        ],
        scale: modelRef.current.scale.toArray(),
      };
    }, []);

    const loadModelFromDataUrl = useCallback(
      (dataUrl: string, onLoad?: (initialTransform: any) => void) => {
        if (isLoadingRef.current) {
          console.log("⏳ Model already loading, skipping duplicate request");
          return;
        }

        console.log("🎨 Starting model load process");
        isLoadingRef.current = true;
        removeModel();

        const getLoaderAndExtension = (
          url: string
        ): { loader: GLTFLoader | OBJLoader | FBXLoader; ext: string } => {
          if (url.includes("data:model/gltf-binary") || url.endsWith(".glb")) {
            return { loader: new GLTFLoader(), ext: "glb" };
          } else if (url.endsWith(".gltf")) {
            return { loader: new GLTFLoader(), ext: "gltf" };
          } else if (url.endsWith(".obj")) {
            return { loader: new OBJLoader(), ext: "obj" };
          } else if (url.endsWith(".fbx")) {
            return { loader: new FBXLoader(), ext: "fbx" };
          }
          return { loader: new GLTFLoader(), ext: "glb" }; // Default fallback
        };

        const { loader, ext } = getLoaderAndExtension(dataUrl);

        const onLoadComplete = (object: THREE.Group | THREE.Object3D) => {
          console.log("✅ Model loaded successfully");
          const group =
            object instanceof THREE.Group
              ? object
              : new THREE.Group().add(object);

          modelRef.current = group;
          sceneRef.current.add(group);

          if (transformControlsRef.current) {
            transformControlsRef.current.attach(group);
          }

          isLoadingRef.current = false;

          const initialTransform = getModelTransform();
          if (initialTransform && onLoad) {
            console.log("🚀 Firing onLoad callback with initial transform");
            onLoad(initialTransform);
          }
        };

        const onLoadError = (error: any) => {
          console.error("❌ Error loading model:", error);
          isLoadingRef.current = false;
        };

        // --- CHANGE START ---
        // Reverted to the type-safe, loader-specific loading logic while keeping the onLoad callback.
        // This fixes the 'instanceof' TypeScript error.
        if (ext === "gltf" || ext === "glb") {
          fetch(dataUrl)
            .then((res) => res.arrayBuffer())
            .then((buffer) => {
              (loader as GLTFLoader).parse(
                buffer,
                "",
                (gltf) => onLoadComplete(gltf.scene),
                onLoadError
              );
            })
            .catch(onLoadError);
        } else if (ext === "obj") {
          fetch(dataUrl)
            .then((res) => res.text())
            .then((text) => {
              const object = (loader as OBJLoader).parse(text);
              onLoadComplete(object);
            })
            .catch(onLoadError);
        } else if (ext === "fbx") {
          fetch(dataUrl)
            .then((res) => res.arrayBuffer())
            .then((buffer) => {
              const object = (loader as FBXLoader).parse(buffer, "");
              onLoadComplete(object);
            })
            .catch(onLoadError);
        }
        // --- CHANGE END ---
      },
      [removeModel, getModelTransform]
    );

    const applyCameraTransform = useCallback((cameraData: any) => {
      if (
        cameraRef.current &&
        controlsRef.current &&
        cameraData &&
        !isSyncingCameraRef.current
      ) {
        console.log("📷 Applying camera transform from remote");
        isSyncingCameraRef.current = true;

        cameraRef.current.position.fromArray(cameraData.position);
        controlsRef.current.target.fromArray(cameraData.target);
        cameraRef.current.updateProjectionMatrix();
        controlsRef.current.update();

        setTimeout(() => {
          isSyncingCameraRef.current = false;
        }, 100);
      }
    }, []);

    useImperativeHandle(ref, () => ({
      loadModel: loadModelFromDataUrl,
      clear: removeModel,
      applyTransform: applyTransformToModel,
      getTransform: getModelTransform,
      applyCameraTransform: applyCameraTransform,
      resetCamera: handleResize,
    }));

    useEffect(() => {
      if (!mountRef.current) return;
      const currentMount = mountRef.current;

      const scene = sceneRef.current;
      scene.background = new THREE.Color(0x111111);

      const gridHelper = new THREE.GridHelper(15, 15, 0x888888, 0x444444);
      scene.add(gridHelper);

      const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
      scene.add(ambientLight);

      const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
      directionalLight.position.set(5, 10, 7.5);
      scene.add(directionalLight);

      const { clientWidth, clientHeight } = currentMount;
      const camera = new THREE.PerspectiveCamera(
        75,
        clientWidth / clientHeight,
        0.1,
        1000
      );
      camera.position.set(7, 7, 7);
      cameraRef.current = camera;

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(clientWidth, clientHeight);
      renderer.setPixelRatio(window.devicePixelRatio);
      rendererRef.current = renderer;
      currentMount.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controlsRef.current = controls;

      let cameraChangeTimeout: NodeJS.Timeout;
      controls.addEventListener("change", () => {
        if (onCameraChange && !isSyncingCameraRef.current) {
          clearTimeout(cameraChangeTimeout);
          cameraChangeTimeout = setTimeout(() => {
            onCameraChange({
              position: camera.position.toArray(),
              target: controls.target.toArray(),
            });
          }, 100);
        }
      });

      const transformControls = new TransformControls(
        camera,
        renderer.domElement
      );
      transformControls.addEventListener("dragging-changed", (event) => {
        if (controlsRef.current) {
          controlsRef.current.enabled = !event.value;
        }
      });

      transformControls.addEventListener("objectChange", () => {
        if (onTransformChange) {
          const transform = getModelTransform();
          if (transform) {
            onTransformChange(transform);
          }
        }
      });
      scene.add(transformControls.getHelper());
      transformControlsRef.current = transformControls;

      const handleKeyDown = (event: KeyboardEvent) => {
        if (!transformControlsRef.current) return;
        switch (event.key.toLowerCase()) {
          case "w":
            transformControlsRef.current.setMode("translate");
            break;
          case "e":
            transformControlsRef.current.setMode("rotate");
            break;
          case "r":
            transformControlsRef.current.setMode("scale");
            break;
        }
      };
      window.addEventListener("keydown", handleKeyDown);

      const animate = () => {
        animationFrameIdRef.current = requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
      };
      animate();

      window.addEventListener("resize", handleResize);

      return () => {
        if (animationFrameIdRef.current) {
          cancelAnimationFrame(animationFrameIdRef.current);
        }
        window.removeEventListener("resize", handleResize);
        window.removeEventListener("keydown", handleKeyDown);
        controls.dispose();
        transformControls.dispose();
        removeModel();
        if (rendererRef.current?.domElement) {
          currentMount.removeChild(rendererRef.current.domElement);
        }
        rendererRef.current?.dispose();
      };
    }, [
      handleResize,
      onTransformChange,
      onCameraChange,
      removeModel,
      getModelTransform,
    ]);

    return <div ref={mountRef} style={{ width: "100%", height: "100%" }} />;
  }
);

Scene.displayName = "Scene";
export default Scene;
