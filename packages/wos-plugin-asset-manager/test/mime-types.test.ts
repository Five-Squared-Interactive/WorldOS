// Copyright (c) 2019-2026 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';
import { getMimeType, getAssetType } from '../src/mime-types.js';

describe('getMimeType', () => {
  it('returns image/png for .png', () => {
    expect(getMimeType('photo.png')).toBe('image/png');
  });

  it('returns image/jpeg for .jpg', () => {
    expect(getMimeType('photo.jpg')).toBe('image/jpeg');
  });

  it('returns image/jpeg for .jpeg', () => {
    expect(getMimeType('photo.jpeg')).toBe('image/jpeg');
  });

  it('returns image/gif for .gif', () => {
    expect(getMimeType('anim.gif')).toBe('image/gif');
  });

  it('returns image/webp for .webp', () => {
    expect(getMimeType('img.webp')).toBe('image/webp');
  });

  it('returns image/svg+xml for .svg', () => {
    expect(getMimeType('icon.svg')).toBe('image/svg+xml');
  });

  it('returns model/gltf-binary for .glb', () => {
    expect(getMimeType('model.glb')).toBe('model/gltf-binary');
  });

  it('returns model/gltf+json for .gltf', () => {
    expect(getMimeType('scene.gltf')).toBe('model/gltf+json');
  });

  it('returns model/obj for .obj', () => {
    expect(getMimeType('mesh.obj')).toBe('model/obj');
  });

  it('returns application/octet-stream for .fbx', () => {
    expect(getMimeType('model.fbx')).toBe('application/octet-stream');
  });

  it('returns audio/mpeg for .mp3', () => {
    expect(getMimeType('song.mp3')).toBe('audio/mpeg');
  });

  it('returns audio/wav for .wav', () => {
    expect(getMimeType('sound.wav')).toBe('audio/wav');
  });

  it('returns audio/ogg for .ogg', () => {
    expect(getMimeType('clip.ogg')).toBe('audio/ogg');
  });

  it('returns application/javascript for .js', () => {
    expect(getMimeType('script.js')).toBe('application/javascript');
  });

  it('returns application/json for .json', () => {
    expect(getMimeType('data.json')).toBe('application/json');
  });

  it('returns video/mp4 for .mp4', () => {
    expect(getMimeType('video.mp4')).toBe('video/mp4');
  });

  it('returns video/webm for .webm', () => {
    expect(getMimeType('clip.webm')).toBe('video/webm');
  });

  it('returns text/plain for .txt', () => {
    expect(getMimeType('readme.txt')).toBe('text/plain');
  });

  it('returns text/html for .html', () => {
    expect(getMimeType('page.html')).toBe('text/html');
  });

  it('returns text/css for .css', () => {
    expect(getMimeType('style.css')).toBe('text/css');
  });

  it('returns application/octet-stream for unknown extension', () => {
    expect(getMimeType('file.xyz')).toBe('application/octet-stream');
  });

  it('returns application/octet-stream for no extension', () => {
    expect(getMimeType('noext')).toBe('application/octet-stream');
  });

  it('handles uppercase extensions', () => {
    expect(getMimeType('PHOTO.PNG')).toBe('image/png');
  });
});

describe('getAssetType', () => {
  it('classifies image/* as texture', () => {
    expect(getAssetType('image/png')).toBe('texture');
    expect(getAssetType('image/jpeg')).toBe('texture');
    expect(getAssetType('image/gif')).toBe('texture');
    expect(getAssetType('image/webp')).toBe('texture');
    expect(getAssetType('image/svg+xml')).toBe('texture');
  });

  it('classifies model/* as model', () => {
    expect(getAssetType('model/gltf-binary')).toBe('model');
    expect(getAssetType('model/gltf+json')).toBe('model');
    expect(getAssetType('model/obj')).toBe('model');
  });

  it('classifies audio/* as audio', () => {
    expect(getAssetType('audio/mpeg')).toBe('audio');
    expect(getAssetType('audio/wav')).toBe('audio');
    expect(getAssetType('audio/ogg')).toBe('audio');
  });

  it('classifies application/javascript as script', () => {
    expect(getAssetType('application/javascript')).toBe('script');
  });

  it('classifies video/* as other', () => {
    expect(getAssetType('video/mp4')).toBe('other');
    expect(getAssetType('video/webm')).toBe('other');
  });

  it('classifies application/octet-stream as other', () => {
    expect(getAssetType('application/octet-stream')).toBe('other');
  });

  it('classifies application/json as other', () => {
    expect(getAssetType('application/json')).toBe('other');
  });

  it('classifies text/* as other', () => {
    expect(getAssetType('text/plain')).toBe('other');
    expect(getAssetType('text/html')).toBe('other');
    expect(getAssetType('text/css')).toBe('other');
  });

  it('classifies unknown mime types as other', () => {
    expect(getAssetType('application/xml')).toBe('other');
  });
});
