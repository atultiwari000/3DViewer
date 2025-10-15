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
}

export interface SceneHandle {
  loadModel: (fileDataUrl: string) => void;
  clear: () => void;
  applyTransform: (transform: any) => void;
  getTransform: () => any | null;
  resetCamera: () => void;
}

const Scene = forwardRef<SceneHandle, SceneProps>(
  ({ onTransformChange }, ref) => {
    const mountRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef(new THREE.Scene());
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const transformControlsRef = useRef<TransformControls | null>(null);
    const modelRef = useRef<THREE.Group | null>(null);
    const animationFrameIdRef = useRef<number | null>(null);
    const isLoadingRef = useRef<boolean>(false);

    // handle window resizing
    const handleResize = useCallback(() => {
      if (cameraRef.current && rendererRef.current && mountRef.current) {
        const { clientWidth, clientHeight } = mountRef.current;
        cameraRef.current.aspect = clientWidth / clientHeight;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(clientWidth, clientHeight);
      }
    }, []);

    const removeModel = () => {
      if (modelRef.current) {
        console.log("Removing existing model");

        // detach from transform controls and hide them
        if (transformControlsRef.current) {
          transformControlsRef.current.detach();
          transformControlsRef.current.enabled = false;
        }

        // remove from scene
        sceneRef.current.remove(modelRef.current);

        // remove of model's geometries and materials to free up resources
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
    };

    const applyTransformToModel = (transform: any) => {
      if (modelRef.current && transform) {
        console.log("Applying transform to model");
        modelRef.current.position.fromArray(transform.position);
        modelRef.current.rotation.set(
          transform.rotation[0],
          transform.rotation[1],
          transform.rotation[2],
          transform.rotation[3]
        );
        modelRef.current.scale.fromArray(transform.scale);
      }
    };

    const getModelTransform = () => {
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
    };

    const loadModelFromDataUrl = (dataUrl: string) => {
      // Prevent multiple simultaneous loads
      if (isLoadingRef.current) {
        console.log("⏳ Model already loading, skipping duplicate request");
        return;
      }

      console.log("🎨 Starting model load process");
      isLoadingRef.current = true;
      removeModel();

      const getLoaderAndExtension = (url: string) => {
        if (url.includes("data:model/gltf-binary") || url.includes(".glb")) {
          return { loader: new GLTFLoader(), ext: "glb" };
        } else if (url.includes(".gltf")) {
          return { loader: new GLTFLoader(), ext: "gltf" };
        } else if (url.includes(".obj")) {
          return { loader: new OBJLoader(), ext: "obj" };
        } else if (url.includes(".fbx")) {
          return { loader: new FBXLoader(), ext: "fbx" };
        }
        // Default to GLTF
        return { loader: new GLTFLoader(), ext: "glb" };
      };

      const { loader } = getLoaderAndExtension(dataUrl);

      const onLoadComplete = (object: THREE.Group | THREE.Object3D) => {
        console.log("✅ Model loaded successfully, adding to scene");
        const group =
          object instanceof THREE.Group
            ? object
            : new THREE.Group().add(object);

        // Store reference first
        modelRef.current = group;

        // Add to scene
        sceneRef.current.add(group);
        console.log("✅ Model added to scene");

        // Attach transform controls
        if (transformControlsRef.current) {
          try {
            transformControlsRef.current.attach(group);
            transformControlsRef.current.enabled = true;
            console.log("✅ Transform controls attached to model");
          } catch (error) {
            console.error("❌ Error attaching transform controls:", error);
          }
        }

        isLoadingRef.current = false;
      };

      const onLoadError = (error: any) => {
        console.error("❌ Error loading model:", error);
        isLoadingRef.current = false;
      };

      if (loader instanceof GLTFLoader) {
        fetch(dataUrl)
          .then((res) => res.arrayBuffer())
          .then((buffer) => {
            loader.parse(
              buffer,
              "",
              (gltf) => onLoadComplete(gltf.scene),
              onLoadError
            );
          })
          .catch(onLoadError);
      } else if (loader instanceof OBJLoader) {
        fetch(dataUrl)
          .then((res) => res.text())
          .then((text) => {
            const object = loader.parse(text);
            onLoadComplete(object);
          })
          .catch(onLoadError);
      } else if (loader instanceof FBXLoader) {
        fetch(dataUrl)
          .then((res) => res.arrayBuffer())
          .then((buffer) => {
            const object = loader.parse(buffer, "");
            onLoadComplete(object);
          })
          .catch(onLoadError);
      }
    };

    useImperativeHandle(ref, () => ({
      loadModel: loadModelFromDataUrl,
      clear: removeModel,
      applyTransform: applyTransformToModel,
      getTransform: getModelTransform,
      resetCamera: handleResize,
    }));

    useEffect(() => {
      if (!mountRef.current) return;
      const currentMount = mountRef.current;

      const scene = sceneRef.current;
      scene.background = new THREE.Color(0xeeeeee);

      const gridHelper = new THREE.GridHelper(10, 10);
      scene.add(gridHelper);

      const axesHelper = new THREE.AxesHelper(5);
      scene.add(axesHelper);

      // Add lighting
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
      scene.add(ambientLight);

      const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
      directionalLight.position.set(5, 10, 5);
      scene.add(directionalLight);

      const { clientWidth, clientHeight } = currentMount;
      const camera = new THREE.PerspectiveCamera(
        75,
        clientWidth / clientHeight,
        0.1,
        1000
      );
      camera.position.set(5, 5, 5);
      camera.lookAt(0, 0, 0);
      cameraRef.current = camera;

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(clientWidth, clientHeight);
      renderer.setPixelRatio(window.devicePixelRatio);
      rendererRef.current = renderer;
      currentMount.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controlsRef.current = controls;

      // Create transform controls
      const transformControls = new TransformControls(
        camera,
        renderer.domElement
      );

      // Set initial mode to translate
      transformControls.setMode("translate");

      // CRITICAL: Disable transform controls initially - prevents rendering artifacts
      transformControls.enabled = false;

      // Set size to make gizmos less intrusive
      transformControls.setSize(0.8);

      transformControls.addEventListener("dragging-changed", (event) => {
        if (controlsRef.current) {
          controlsRef.current.enabled = !event.value;
        }
      });

      transformControls.addEventListener("objectChange", () => {
        if (modelRef.current && onTransformChange) {
          const transform = {
            position: modelRef.current.position.toArray(),
            rotation: [
              modelRef.current.rotation.x,
              modelRef.current.rotation.y,
              modelRef.current.rotation.z,
              modelRef.current.rotation.order,
            ],
            scale: modelRef.current.scale.toArray(),
          };
          onTransformChange(transform);
        }
      });

      // Add transform controls to scene
      scene.add(transformControls);
      transformControlsRef.current = transformControls;
      console.log(
        "✅ Transform controls added to scene (disabled until model loads)"
      );

      // Add keyboard controls for transform mode
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

        scene.children.forEach((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry?.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach((mat) => mat.dispose());
            } else {
              child.material?.dispose();
            }
          }
        });

        if (rendererRef.current) {
          rendererRef.current.dispose();
          if (currentMount && rendererRef.current.domElement) {
            if (currentMount.contains(rendererRef.current.domElement)) {
              currentMount.removeChild(rendererRef.current.domElement);
            }
          }
        }
      };
    }, [handleResize, onTransformChange]);

    return <div ref={mountRef} style={{ width: "100%", height: "100%" }} />;
  }
);

Scene.displayName = "Scene";
export default Scene;
