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
import { EulerOrder, Transform, CameraTransform } from "@/hooks/useWebRTC";

interface SceneProps {
  onTransformChange: (transform: Transform) => void;
  onCameraChange: (camera: CameraTransform) => void;
}

export interface SceneHandle {
  loadModel: (
    fileDataUrl: string,
    onComplete?: (transform: Transform) => void
  ) => void;
  clear: () => void;
  applyTransform: (transform: Transform) => void;
  applyCameraTransform: (camera: CameraTransform) => void;
}

const Scene = forwardRef<SceneHandle, SceneProps>(
  ({ onTransformChange, onCameraChange }, ref) => {
    const mountRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef(new THREE.Scene());
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const transformControlsRef = useRef<TransformControls | null>(null);
    const modelRef = useRef<THREE.Object3D | null>(null);
    const animationFrameIdRef = useRef<number | null>(null);

    // feedback loop prevention
    const isApplyingUpdateRef = useRef(false);

    useImperativeHandle(ref, () => ({
      loadModel: (dataUrl, onComplete) => {
        removeModel();
        const { loader, ext } = getLoaderAndExt(dataUrl);

        const onLoad = (object: THREE.Object3D) => {
          modelRef.current = object;
          sceneRef.current.add(object);
          transformControlsRef.current?.attach(object);

          if (onComplete) {
            const { position, rotation, scale } = object;
            onComplete({
              position: position.toArray(),
              rotation: [
                rotation.x,
                rotation.y,
                rotation.z,
                rotation.order as EulerOrder,
              ],
              scale: scale.toArray(),
            });
          }
        };

        const onError = (error: any) =>
          console.error(`Error loading .${ext} model:`, error);

        fetch(dataUrl)
          .then((res) => res.arrayBuffer())
          .then((buffer) => {
            if (ext === "gltf" || ext === "glb") {
              (loader as GLTFLoader).parse(
                buffer,
                "",
                (gltf) => onLoad(gltf.scene),
                onError
              );
            } else if (ext === "fbx") {
              const scene = (loader as FBXLoader).parse(buffer, "");
              onLoad(scene);
            } else {
              // For obj, we need to read as text
              return new Response(buffer).text().then((text) => {
                const object = (loader as OBJLoader).parse(text);
                onLoad(object);
              });
            }
          })
          .catch(onError);
      },
      clear: removeModel,
      applyTransform: (transform) => {
        if (!modelRef.current) return;
        isApplyingUpdateRef.current = true;
        modelRef.current.position.fromArray(transform.position);
        modelRef.current.rotation.set(
          transform.rotation[0],
          transform.rotation[1],
          transform.rotation[2],
          transform.rotation[3]
        );
        modelRef.current.scale.fromArray(transform.scale);
        isApplyingUpdateRef.current = false;
      },
      applyCameraTransform: (camera) => {
        if (!cameraRef.current || !controlsRef.current) return;
        isApplyingUpdateRef.current = true;
        cameraRef.current.position.fromArray(camera.position);
        controlsRef.current.target.fromArray(camera.target);
        controlsRef.current.update(); // update controls after setting camera
        isApplyingUpdateRef.current = false;
      },
    }));

    const getLoaderAndExt = (url: string) => {
      const lowerUrl = url.toLowerCase();
      if (lowerUrl.endsWith(".glb") || lowerUrl.includes("model/gltf-binary"))
        return { loader: new GLTFLoader(), ext: "glb" };
      if (lowerUrl.endsWith(".gltf"))
        return { loader: new GLTFLoader(), ext: "gltf" };
      if (lowerUrl.endsWith(".obj"))
        return { loader: new OBJLoader(), ext: "obj" };
      if (lowerUrl.endsWith(".fbx"))
        return { loader: new FBXLoader(), ext: "fbx" };
      return { loader: new GLTFLoader(), ext: "glb" }; // Fallback
    };

    const removeModel = () => {
      if (modelRef.current) {
        transformControlsRef.current?.detach();
        sceneRef.current.remove(modelRef.current);
        modelRef.current = null;
      }
    };

    // Scene setup (only runs once)
    useEffect(() => {
      const mount = mountRef.current!;

      const scene = sceneRef.current;
      scene.background = new THREE.Color(0x1a1a1a);
      scene.add(new THREE.GridHelper(20, 20, 0x888888, 0x444444));
      scene.add(new THREE.AmbientLight(0xffffff, 0.7));

      const camera = new THREE.PerspectiveCamera(
        75,
        mount.clientWidth / mount.clientHeight,
        0.1,
        1000
      );
      camera.position.set(5, 5, 5);
      cameraRef.current = camera;

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      renderer.setPixelRatio(window.devicePixelRatio);
      rendererRef.current = renderer;
      mount.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controlsRef.current = controls;

      const transformControls = new TransformControls(
        camera,
        renderer.domElement
      );
      scene.add(transformControls.getHelper());
      transformControlsRef.current = transformControls;

      const animate = () => {
        animationFrameIdRef.current = requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
      };
      animate();

      const handleResize = () => {
        camera.aspect = mount.clientWidth / mount.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(mount.clientWidth, mount.clientHeight);
      };
      window.addEventListener("resize", handleResize);

      return () => {
        window.removeEventListener("resize", handleResize);
        if (animationFrameIdRef.current)
          cancelAnimationFrame(animationFrameIdRef.current);
        mount.removeChild(renderer.domElement);
        controls.dispose();
        transformControls.dispose();
      };
    }, []);

    useEffect(() => {
      const controls = controlsRef.current!;
      const transformControls = transformControlsRef.current!;

      let cameraTimeout: NodeJS.Timeout;
      const handleCameraChange = () => {
        if (isApplyingUpdateRef.current) return;
        clearTimeout(cameraTimeout);
        cameraTimeout = setTimeout(() => {
          onCameraChange({
            position: cameraRef.current!.position.toArray() as [
              number,
              number,
              number
            ],
            target: controls.target.toArray() as [number, number, number],
          });
        }, 100);
      };

      const handleTransformChange = () => {
        if (isApplyingUpdateRef.current || !modelRef.current) return;
        const { position, rotation, scale } = modelRef.current;
        onTransformChange({
          position: position.toArray() as [number, number, number],
          rotation: [
            rotation.x,
            rotation.y,
            rotation.z,
            rotation.order as EulerOrder,
          ],
          scale: scale.toArray() as [number, number, number],
        });
      };

      const handleDraggingChanged = (event: THREE.Event) => {
        controls.enabled = !event.value;
      };

      controls.addEventListener("change", handleCameraChange);
      transformControls.addEventListener("objectChange", handleTransformChange);
      transformControls.addEventListener(
        "dragging-changed",
        handleDraggingChanged
      );

      return () => {
        controls.removeEventListener("change", handleCameraChange);
        transformControls.removeEventListener(
          "objectChange",
          handleTransformChange
        );
        transformControls.removeEventListener(
          "dragging-changed",
          handleDraggingChanged
        );
      };
    }, [onCameraChange, onTransformChange]);

    return <div ref={mountRef} style={{ width: "100%", height: "100%" }} />;
  }
);

Scene.displayName = "Scene";
export default Scene;
