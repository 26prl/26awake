"use strict";
// The site only opens on computers (PCs, laptops, including touchscreen laptops). Phones and tablets are sent to
// mobile.html. Loaded at the top of each page's <head>, so they leave before anything is drawn.
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

if (!/\/mobile(\.html)?$/.test(location.pathname) && window.isPhone()) location.replace("mobile.html");
