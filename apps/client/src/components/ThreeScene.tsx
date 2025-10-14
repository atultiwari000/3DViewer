"use client";

import React, {
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { Button } from "./ui/button";
import { Upload, Trash2, BoxSelect } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { RTCDataChannelMessage } from "@/lib/types";
import { TransformControls } from "three/addons/controls/TransformControls.js";

interface ThreeSceneProps {
  dataChannel: RTCDataChannel | null;
}

const ThreeScene = forwardRef(({ dataChannel }: ThreeSceneProps, ref) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const sceneRef = useRef(new THREE.Scene());
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const transformControlsRef = useRef<TransformControls | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);

  const handleResize = useCallback(() => {
    if (cameraRef.current && rendererRef.current && mountRef.current) {
      const { clientWidth, clientHeight } = mountRef.current;
      cameraRef.current.aspect = clientWidth / clientHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(clientWidth, clientHeight);
    }
  }, []);

  useImperativeHandle(ref, () => ({
    clear: () => removeModel(false),
    resetCamera: handleResize,
  }));

  const sendData = useCallback(
    (payload: any) => {
      if (dataChannel?.readyState === "open") {
        const message: RTCDataChannelMessage = { type: "three", payload };
        dataChannel.send(JSON.stringify(message));
      }
    },
    [dataChannel]
  );

  const handleModelTransform = useCallback(() => {
    if (modelRef.current) {
      sendData({
        action: "transform",
        position: modelRef.current.position.toArray(),
        rotation: [
          modelRef.current.rotation.x,
          modelRef.current.rotation.y,
          modelRef.current.rotation.z,
        ],
        scale: modelRef.current.scale.toArray(),
      });
    }
  }, [sendData]);

  const onModelLoad = useCallback(
    (object: THREE.Group, broadcast: boolean) => {
      if (modelRef.current) {
        if (transformControlsRef.current) transformControlsRef.current.detach();
        sceneRef.current.remove(modelRef.current);
      }
      modelRef.current = object;
      sceneRef.current.add(object);
      fitCameraToObject(object);

      if (transformControlsRef.current) {
        transformControlsRef.current.attach(object);
      }

      if (broadcast) {
        toast({
          title: "Model loaded",
          description: "Collaborate with your peer!",
        });
        handleModelTransform();
      }
    },
    [handleModelTransform, toast]
  );

  const removeModel = (broadcast = true) => {
    if (modelRef.current) {
      if (transformControlsRef.current) {
        transformControlsRef.current.detach();
      }
      sceneRef.current.remove(modelRef.current);
      modelRef.current = null;
      if (broadcast) {
        sendData({ action: "remove" });
      }
    }
  };

  useEffect(() => {
    if (!mountRef.current) return;
    const currentMount = mountRef.current;

    const scene = sceneRef.current;
    scene.background = new THREE.Color(0xeeeeee);

    const { clientWidth, clientHeight } = currentMount;
    const camera = new THREE.PerspectiveCamera(
      75,
      clientWidth / clientHeight,
      0.1,
      1000
    );
    camera.position.z = 5;
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(clientWidth, clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    currentMount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controlsRef.current = controls;

    const transformControls = new TransformControls(
      camera,
      renderer.domElement
    );
    transformControls.addEventListener("dragging-changed", (event) => {
      controls.enabled = !event.value;
    });
    transformControls.addEventListener("mouseUp", handleModelTransform);
    scene.add(transformControls);
    transformControlsRef.current = transformControls;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(5, 10, 7.5);
    scene.add(directionalLight);

    const gridHelper = new THREE.GridHelper(10, 10, 0x009688, 0xbbbbbb);
    scene.add(gridHelper);

    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(currentMount);

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.unobserve(currentMount);
      if (
        rendererRef.current &&
        currentMount.contains(rendererRef.current.domElement)
      ) {
        currentMount.removeChild(rendererRef.current.domElement);
      }
      transformControls.dispose();
      controls.dispose();
    };
  }, [handleModelTransform, handleResize]);

  useEffect(() => {
    const handleThreeMessage = (event: Event) => {
      const customEvent = event as CustomEvent;
      const { action, ...payload } = customEvent.detail;
      const model = modelRef.current;

      if (!model) return;

      if (action === "transform") {
        model.position.fromArray(payload.position);
        model.rotation.set(
          payload.rotation[0],
          payload.rotation[1],
          payload.rotation[2]
        );
        model.scale.fromArray(payload.scale);
      } else if (action === "remove") {
        if (transformControlsRef.current) transformControlsRef.current.detach();
        sceneRef.current.remove(model);
        modelRef.current = null;
      }
    };
    window.addEventListener("three-message", handleThreeMessage);
    return () =>
      window.removeEventListener("three-message", handleThreeMessage);
  }, []);

  const loadModel = (file: File) => {
    const fileName = file.name;
    const extension = fileName.split(".").pop()?.toLowerCase();

    const reader = new FileReader();
    reader.onload = (event) => {
      const contents = event.target?.result;
      if (!contents) return;

      let loader: GLTFLoader | OBJLoader | FBXLoader;
      try {
        switch (extension) {
          case "gltf":
          case "glb":
            loader = new GLTFLoader();
            loader.parse(
              contents as ArrayBuffer,
              "",
              (gltf) => onModelLoad(gltf.scene, true),
              (error) => {
                console.error("GLTF Parse Error:", error);
                toast({
                  title: "Error parsing GLTF model",
                  variant: "destructive",
                });
              }
            );
            break;
          case "obj":
            loader = new OBJLoader();
            onModelLoad(loader.parse(contents as string, ""), true);
            break;
          case "fbx":
            loader = new FBXLoader();
            onModelLoad(loader.parse(contents as ArrayBuffer, ""), true);
            break;
          default:
            toast({
              title: "Unsupported File Type",
              description: `.${extension} files are not supported.`,
              variant: "destructive",
            });
            return;
        }
      } catch (error: any) {
        console.error("Model Load Error:", error);
        toast({
          title: `Error loading ${extension?.toUpperCase()} model`,
          description: error.message,
          variant: "destructive",
        });
      }
    };

    if (extension === "obj") {
      reader.readAsText(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
  };

  const fitCameraToObject = (object: THREE.Object3D) => {
    if (!cameraRef.current || !controlsRef.current) return;
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = cameraRef.current.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
    cameraZ *= 1.5; // zoom out a bit

    cameraRef.current.position.set(
      center.x,
      center.y + size.y * 0.2,
      center.z + cameraZ
    );

    const minZ = box.min.z;
    const cameraToFarEdge = minZ < 0 ? -minZ + cameraZ : cameraZ - minZ;
    cameraRef.current.far = cameraToFarEdge * 3;
    cameraRef.current.updateProjectionMatrix();

    controlsRef.current.target.copy(center);
    controlsRef.current.update();
  };

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      loadModel(file);
    }
    if (event.target) event.target.value = "";
  };

  const toggleTransformMode = () => {
    if (transformControlsRef.current) {
      const currentMode = transformControlsRef.current.getMode();
      const newMode =
        currentMode === "translate"
          ? "rotate"
          : currentMode === "rotate"
          ? "scale"
          : "translate";
      transformControlsRef.current.setMode(newMode);
      toast({
        title: `Mode: ${newMode.charAt(0).toUpperCase() + newMode.slice(1)}`,
      });
    }
  };

  return (
    <div className="h-full w-full relative">
      <div ref={mountRef} className="h-full w-full rounded-b-lg" />
      <div className="absolute top-4 right-4 flex gap-2">
        <Button
          onClick={() => fileInputRef.current?.click()}
          variant="secondary"
          size="sm"
          disabled={!dataChannel || dataChannel.readyState !== "open"}
        >
          <Upload />
          Import Model
        </Button>
        {modelRef.current && (
          <>
            <Button
              onClick={toggleTransformMode}
              variant="secondary"
              size="icon"
              title="Toggle Transform Mode (Translate/Rotate/Scale)"
            >
              <BoxSelect />
            </Button>
            <Button
              onClick={() => removeModel(true)}
              variant="destructive"
              size="sm"
            >
              <Trash2 />
              Remove
            </Button>
          </>
        )}
      </div>
      <input
        type="file"
        ref={fileInputRef}
        onChange={onFileChange}
        className="hidden"
        accept=".gltf,.glb,.obj,.fbx"
      />
    </div>
  );
});

ThreeScene.displayName = "ThreeScene";

export default ThreeScene;
