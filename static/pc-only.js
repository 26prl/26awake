"use strict";
// The full site is for computers (PCs, laptops, including touchscreen laptops). Phones and tablets may only open
// 2048 and sudoku (PHONE_OK); anything else sends them to mobile.html, which links to those two and recommends a
// computer for the full experience. Loaded at the top of each page's <head>, so they leave before anything is drawn.
// A device counts as a phone/tablet if
//   * its browser says so (user agent / client hints), or
//   * it's an iPad pretending to be a Mac (Safari on iPad says "Macintosh" but has a touchscreen), or
//   * it's an Android phone/tablet in "desktop site" mode (says "Linux", has only a touchscreen, no mouse/trackpad).
// mobile.html uses isPhone() too, to send computers that land there back home.

window.isPhone = () => {
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod|Mobile|Tablet|Silk|Kindle|BlackBerry|BB10|Opera Mini|IEMobile|webOS/i.test(ua)) return true;
  if (navigator.userAgentData && navigator.userAgentData.mobile) return true;
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true; // iPad
  // "desktop site" on an Android phone/tablet says "Linux"; with only a touchscreen it's not a computer
  // (Windows and Chromebook touch laptops are always let in)
  if (/Linux/.test(ua) && !/CrOS/.test(ua) && window.matchMedia
      && matchMedia("(any-pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches) return true;
  return false;
};

// pages a phone may open: the phone page itself, 2048 and sudoku (and the old links that forward to them)
const PHONE_OK = /\/(mobile|2048|sudoku|game|game1|game3)(\.html)?$/;
if (!PHONE_OK.test(location.pathname) && window.isPhone()) location.replace("/mobile.html");
