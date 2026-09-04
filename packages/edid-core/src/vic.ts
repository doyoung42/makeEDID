/**
 * CTA-861 Video Identification Codes.
 *
 * Reference timings for VIC 1-127 and 193-219, so a Short Video Descriptor can
 * be shown as "3840x2160p @ 60 Hz 16:9" instead of a bare number.
 *
 * Source: edid-decode (git.linuxtv.org) edid_cta_modes table, MIT-like licence;
 * the timings themselves are defined by CTA-861-H. Upstream did not resolve
 * h_total/v_total or porch breakdowns, so only the fields below are carried.
 */

export interface VicTiming {
  vic: number;
  name: string;
  hActive: number;
  vActive: number;
  interlaced: boolean;
  aspectRatio: string;
  refreshHz: number;
  pixelClockKhz: number | null;
}

const TABLE: readonly VicTiming[] = [
  { vic: 1, name: "640x480@60Hz 4:3", hActive: 640, vActive: 480, interlaced: false, aspectRatio: "4:3", refreshHz: 60, pixelClockKhz: 25175 },
  { vic: 2, name: "720x480@60Hz 4:3", hActive: 720, vActive: 480, interlaced: false, aspectRatio: "4:3", refreshHz: 60, pixelClockKhz: 27000 },
  { vic: 3, name: "720x480@60Hz 16:9", hActive: 720, vActive: 480, interlaced: false, aspectRatio: "16:9", refreshHz: 60, pixelClockKhz: 27000 },
  { vic: 4, name: "1280x720@60Hz 16:9", hActive: 1280, vActive: 720, interlaced: false, aspectRatio: "16:9", refreshHz: 60, pixelClockKhz: 74250 },
  { vic: 5, name: "1920x1080i@60Hz 16:9", hActive: 1920, vActive: 1080, interlaced: true, aspectRatio: "16:9", refreshHz: 60, pixelClockKhz: 74250 },
  { vic: 6, name: "1440x480i@60Hz 4:3", hActive: 1440, vActive: 480, interlaced: true, aspectRatio: "4:3", refreshHz: 60, pixelClockKhz: 27000 },
  { vic: 7, name: "1440x480i@60Hz 16:9", hActive: 1440, vActive: 480, interlaced: true, aspectRatio: "16:9", refreshHz: 60, pixelClockKhz: 27000 },
  { vic: 8, name: "1440x240@60Hz 4:3", hActive: 1440, vActive: 240, interlaced: false, aspectRatio: "4:3", refreshHz: 60, pixelClockKhz: 27000 },
  { vic: 9, name: "1440x240@60Hz 16:9", hActive: 1440, vActive: 240, interlaced: false, aspectRatio: "16:9", refreshHz: 60, pixelClockKhz: 27000 },
  { vic: 10, name: "2880x480i@60Hz 4:3", hActive: 2880, vActive: 480, interlaced: true, aspectRatio: "4:3", refreshHz: 60, pixelClockKhz: 54000 },
  { vic: 11, name: "2880x480i@60Hz 16:9", hActive: 2880, vActive: 480, interlaced: true, aspectRatio: "16:9", refreshHz: 60, pixelClockKhz: 54000 },
  { vic: 12, name: "2880x240@60Hz 4:3", hActive: 2880, vActive: 240, interlaced: false, aspectRatio: "4:3", refreshHz: 60, pixelClockKhz: 54000 },
  { vic: 13, name: "2880x240@60Hz 16:9", hActive: 2880, vActive: 240, interlaced: false, aspectRatio: "16:9", refreshHz: 60, pixelClockKhz: 54000 },
  { vic: 14, name: "1440x480@60Hz 4:3", hActive: 1440, vActive: 480, interlaced: false, aspectRatio: "4:3", refreshHz: 60, pixelClockKhz: 54000 },
  { vic: 15, name: "1440x480@60Hz 16:9", hActive: 1440, vActive: 480, interlaced: false, aspectRatio: "16:9", refreshHz: 60, pixelClockKhz: 54000 },
  { vic: 16, name: "1920x1080@60Hz 16:9", hActive: 1920, vActive: 1080, interlaced: false, aspectRatio: "16:9", refreshHz: 60, pixelClockKhz: 148500 },
  { vic: 17, name: "720x576@50Hz 4:3", hActive: 720, vActive: 576, interlaced: false, aspectRatio: "4:3", refreshHz: 50, pixelClockKhz: 27000 },
  { vic: 18, name: "720x576@50Hz 16:9", hActive: 720, vActive: 576, interlaced: false, aspectRatio: "16:9", refreshHz: 50, pixelClockKhz: 27000 },
  { vic: 19, name: "1280x720@50Hz 16:9", hActive: 1280, vActive: 720, interlaced: false, aspectRatio: "16:9", refreshHz: 50, pixelClockKhz: 74250 },
  { vic: 20, name: "1920x1080i@50Hz 16:9", hActive: 1920, vActive: 1080, interlaced: true, aspectRatio: "16:9", refreshHz: 50, pixelClockKhz: 74250 },
  { vic: 21, name: "1440x576i@50Hz 4:3", hActive: 1440, vActive: 576, interlaced: true, aspectRatio: "4:3", refreshHz: 50, pixelClockKhz: 27000 },
  { vic: 22, name: "1440x576i@50Hz 16:9", hActive: 1440, vActive: 576, interlaced: true, aspectRatio: "16:9", refreshHz: 50, pixelClockKhz: 27000 },
  { vic: 23, name: "1440x288@50Hz 4:3", hActive: 1440, vActive: 288, interlaced: false, aspectRatio: "4:3", refreshHz: 50, pixelClockKhz: 27000 },
  { vic: 24, name: "1440x288@50Hz 16:9", hActive: 1440, vActive: 288, interlaced: false, aspectRatio: "16:9", refreshHz: 50, pixelClockKhz: 27000 },
  { vic: 25, name: "2880x576i@50Hz 4:3", hActive: 2880, vActive: 576, interlaced: true, aspectRatio: "4:3", refreshHz: 50, pixelClockKhz: 54000 },
  { vic: 26, name: "2880x576i@50Hz 16:9", hActive: 2880, vActive: 576, interlaced: true, aspectRatio: "16:9", refreshHz: 50, pixelClockKhz: 54000 },
  { vic: 27, name: "2880x288@50Hz 4:3", hActive: 2880, vActive: 288, interlaced: false, aspectRatio: "4:3", refreshHz: 50, pixelClockKhz: 54000 },
  { vic: 28, name: "2880x288@50Hz 16:9", hActive: 2880, vActive: 288, interlaced: false, aspectRatio: "16:9", refreshHz: 50, pixelClockKhz: 54000 },
  { vic: 29, name: "1440x576@50Hz 4:3", hActive: 1440, vActive: 576, interlaced: false, aspectRatio: "4:3", refreshHz: 50, pixelClockKhz: 54000 },
  { vic: 30, name: "1440x576@50Hz 16:9", hActive: 1440, vActive: 576, interlaced: false, aspectRatio: "16:9", refreshHz: 50, pixelClockKhz: 54000 },
  { vic: 31, name: "1920x1080@50Hz 16:9", hActive: 1920, vActive: 1080, interlaced: false, aspectRatio: "16:9", refreshHz: 50, pixelClockKhz: 148500 },
  { vic: 32, name: "1920x1080@24Hz 16:9", hActive: 1920, vActive: 1080, interlaced: false, aspectRatio: "16:9", refreshHz: 24, pixelClockKhz: 74250 },
  { vic: 33, name: "1920x1080@25Hz 16:9", hActive: 1920, vActive: 1080, interlaced: false, aspectRatio: "16:9", refreshHz: 25, pixelClockKhz: 74250 },
  { vic: 34, name: "1920x1080@30Hz 16:9", hActive: 1920, vActive: 1080, interlaced: false, aspectRatio: "16:9", refreshHz: 30, pixelClockKhz: 74250 },
  { vic: 35, name: "2880x480@60Hz 4:3", hActive: 2880, vActive: 480, interlaced: false, aspectRatio: "4:3", refreshHz: 60, pixelClockKhz: 108000 },
  { vic: 36, name: "2880x480@60Hz 16:9", hActive: 2880, vActive: 480, interlaced: false, aspectRatio: "16:9", refreshHz: 60, pixelClockKhz: 108000 },
  { vic: 37, name: "2880x576@50Hz 4:3", hActive: 2880, vActive: 576, interlaced: false, aspectRatio: "4:3", refreshHz: 50, pixelClockKhz: 108000 },
  { vic: 38, name: "2880x576@50Hz 16:9", hActive: 2880, vActive: 576, interlaced: false, aspectRatio: "16:9", refreshHz: 50, pixelClockKhz: 108000 },
  { vic: 39, name: "1920x1080i@50Hz 16:9", hActive: 1920, vActive: 1080, interlaced: true, aspectRatio: "16:9", refreshHz: 50, pixelClockKhz: 72000 },
  { vic: 40, name: "1920x1080i@100Hz 16:9", hActive: 1920, vActive: 1080, interlaced: true, aspectRatio: "16:9", refreshHz: 100, pixelClockKhz: 148500 },
  { vic: 41, name: "1280x720@100Hz 16:9", hActive: 1280, vActive: 720, interlaced: false, aspectRatio: "16:9", refreshHz: 100, pixelClockKhz: 148500 },
  { vic: 42, name: "720x576@100Hz 4:3", hActive: 720, vActive: 576, interlaced: false, aspectRatio: "4:3", refreshHz: 100, pixelClockKhz: 54000 },
  { vic: 43, name: "720x576@100Hz 16:9", hActive: 720, vActive: 576, interlaced: false, aspectRatio: "16:9", refreshHz: 100, pixelClockKhz: 54000 },
  { vic: 44, name: "1440x576@100Hz 4:3", hActive: 1440, vActive: 576, interlaced: false, aspectRatio: "4:3", refreshHz: 100, pixelClockKhz: 54000 },
  { vic: 45, name: "1440x576@100Hz 16:9", hActive: 1440, vActive: 576, interlaced: false, aspectRatio: "16:9", refreshHz: 100, pixelClockKhz: 54000 },
  { vic: 46, name: "1920x1080i@120Hz 16:9", hActive: 1920, vActive: 1080, interlaced: true, aspectRatio: "16:9", refreshHz: 120, pixelClockKhz: 148500 },
  { vic: 47, name: "1280x720@120Hz 16:9", hActive: 1280, vActive: 720, interlaced: false, aspectRatio: "16:9", refreshHz: 120, pixelClockKhz: 148500 },
  { vic: 48, name: "720x480@120Hz 4:3", hActive: 720, vActive: 480, interlaced: false, aspectRatio: "4:3", refreshHz: 120, pixelClockKhz: 54000 },
  { vic: 49, name: "720x480@120Hz 16:9", hActive: 720, vActive: 480, interlaced: false, aspectRatio: "16:9", refreshHz: 120, pixelClockKhz: 54000 },
  { vic: 50, name: "1440x480i@120Hz 4:3", hActive: 1440, vActive: 480, interlaced: true, aspectRatio: "4:3", refreshHz: 120, pixelClockKhz: 54000 },
  { vic: 51, name: "1440x480i@120Hz 16:9", hActive: 1440, vActive: 480, interlaced: true, aspectRatio: "16:9", refreshHz: 120, pixelClockKhz: 54000 },
  { vic: 52, name: "720x576@200Hz 4:3", hActive: 720, vActive: 576, interlaced: false, aspectRatio: "4:3", refreshHz: 200, pixelClockKhz: 108000 },
  { vic: 53, name: "720x576@200Hz 16:9", hActive: 720, vActive: 576, interlaced: false, aspectRatio: "16:9", refreshHz: 200, pixelClockKhz: 108000 },
  { vic: 54, name: "1440x576i@200Hz 4:3", hActive: 1440, vActive: 576, interlaced: true, aspectRatio: "4:3", refreshHz: 200, pixelClockKhz: 108000 },
  { vic: 55, name: "1440x576i@200Hz 16:9", hActive: 1440, vActive: 576, interlaced: true, aspectRatio: "16:9", refreshHz: 200, pixelClockKhz: 108000 },
  { vic: 56, name: "720x480@240Hz 4:3", hActive: 720, vActive: 480, interlaced: false, aspectRatio: "4:3", refreshHz: 240, pixelClockKhz: 108000 },
  { vic: 57, name: "720x480@240Hz 16:9", hActive: 720, vActive: 480, interlaced: false, aspectRatio: "16:9", refreshHz: 240, pixelClockKhz: 108000 },
  { vic: 58, name: "1440x480i@240Hz 4:3", hActive: 1440, vActive: 480, interlaced: true, aspectRatio: "4:3", refreshHz: 240, pixelClockKhz: 108000 },
  { vic: 59, name: "1440x480i@240Hz 16:9", hActive: 1440, vActive: 480, interlaced: true, aspectRatio: "16:9", refreshHz: 240, pixelClockKhz: 108000 },
  { vic: 60, name: "1280x720@24Hz 16:9", hActive: 1280, vActive: 720, interlaced: false, aspectRatio: "16:9", refreshHz: 24, pixelClockKhz: 59400 },
  { vic: 61, name: "1280x720@25Hz 16:9", hActive: 1280, vActive: 720, interlaced: false, aspectRatio: "16:9", refreshHz: 25, pixelClockKhz: 74250 },
  { vic: 62, name: "1280x720@30Hz 16:9", hActive: 1280, vActive: 720, interlaced: false, aspectRatio: "16:9", refreshHz: 30, pixelClockKhz: 74250 },
  { vic: 63, name: "1920x1080@120Hz 16:9", hActive: 1920, vActive: 1080, interlaced: false, aspectRatio: "16:9", refreshHz: 120, pixelClockKhz: 297000 },
  { vic: 64, name: "1920x1080@100Hz 16:9", hActive: 1920, vActive: 1080, interlaced: false, aspectRatio: "16:9", refreshHz: 100, pixelClockKhz: 297000 },
  { vic: 65, name: "1280x720@24Hz 64:27", hActive: 1280, vActive: 720, interlaced: false, aspectRatio: "64:27", refreshHz: 24, pixelClockKhz: 59400 },
  { vic: 66, name: "1280x720@25Hz 64:27", hActive: 1280, vActive: 720, interlaced: false, aspectRatio: "64:27", refreshHz: 25, pixelClockKhz: 74250 },
  { vic: 67, name: "1280x720@30Hz 64:27", hActive: 1280, vActive: 720, interlaced: false, aspectRatio: "64:27", refreshHz: 30, pixelClockKhz: 74250 },
  { vic: 68, name: "1280x720@50Hz 64:27", hActive: 1280, vActive: 720, interlaced: false, aspectRatio: "64:27", refreshHz: 50, pixelClockKhz: 74250 },
  { vic: 69, name: "1280x720@60Hz 64:27", hActive: 1280, vActive: 720, interlaced: false, aspectRatio: "64:27", refreshHz: 60, pixelClockKhz: 74250 },
  { vic: 70, name: "1280x720@100Hz 64:27", hActive: 1280, vActive: 720, interlaced: false, aspectRatio: "64:27", refreshHz: 100, pixelClockKhz: 148500 },
  { vic: 71, name: "1280x720@120Hz 64:27", hActive: 1280, vActive: 720, interlaced: false, aspectRatio: "64:27", refreshHz: 120, pixelClockKhz: 148500 },
  { vic: 72, name: "1920x1080@24Hz 64:27", hActive: 1920, vActive: 1080, interlaced: false, aspectRatio: "64:27", refreshHz: 24, pixelClockKhz: 74250 },
  { vic: 73, name: "1920x1080@25Hz 64:27", hActive: 1920, vActive: 1080, interlaced: false, aspectRatio: "64:27", refreshHz: 25, pixelClockKhz: 74250 },
  { vic: 74, name: "1920x1080@30Hz 64:27", hActive: 1920, vActive: 1080, interlaced: false, aspectRatio: "64:27", refreshHz: 30, pixelClockKhz: 74250 },
  { vic: 75, name: "1920x1080@50Hz 64:27", hActive: 1920, vActive: 1080, interlaced: false, aspectRatio: "64:27", refreshHz: 50, pixelClockKhz: 148500 },
  { vic: 76, name: "1920x1080@60Hz 64:27", hActive: 1920, vActive: 1080, interlaced: false, aspectRatio: "64:27", refreshHz: 60, pixelClockKhz: 148500 },
  { vic: 77, name: "1920x1080@100Hz 64:27", hActive: 1920, vActive: 1080, interlaced: false, aspectRatio: "64:27", refreshHz: 100, pixelClockKhz: 297000 },
  { vic: 78, name: "1920x1080@120Hz 64:27", hActive: 1920, vActive: 1080, interlaced: false, aspectRatio: "64:27", refreshHz: 120, pixelClockKhz: 297000 },
  { vic: 79, name: "1680x720@24Hz 64:27", hActive: 1680, vActive: 720, interlaced: false, aspectRatio: "64:27", refreshHz: 24, pixelClockKhz: 59400 },
  { vic: 80, name: "1680x720@25Hz 64:27", hActive: 1680, vActive: 720, interlaced: false, aspectRatio: "64:27", refreshHz: 25, pixelClockKhz: 59400 },
  { vic: 81, name: "1680x720@30Hz 64:27", hActive: 1680, vActive: 720, interlaced: false, aspectRatio: "64:27", refreshHz: 30, pixelClockKhz: 59400 },
  { vic: 82, name: "1680x720@50Hz 64:27", hActive: 1680, vActive: 720, interlaced: false, aspectRatio: "64:27", refreshHz: 50, pixelClockKhz: 82500 },
  { vic: 83, name: "1680x720@60Hz 64:27", hActive: 1680, vActive: 720, interlaced: false, aspectRatio: "64:27", refreshHz: 60, pixelClockKhz: 99000 },
  { vic: 84, name: "1680x720@100Hz 64:27", hActive: 1680, vActive: 720, interlaced: false, aspectRatio: "64:27", refreshHz: 100, pixelClockKhz: 165000 },
  { vic: 85, name: "1680x720@120Hz 64:27", hActive: 1680, vActive: 720, interlaced: false, aspectRatio: "64:27", refreshHz: 120, pixelClockKhz: 198000 },
  { vic: 86, name: "2560x1080@24Hz 64:27", hActive: 2560, vActive: 1080, interlaced: false, aspectRatio: "64:27", refreshHz: 24, pixelClockKhz: 99000 },
  { vic: 87, name: "2560x1080@25Hz 64:27", hActive: 2560, vActive: 1080, interlaced: false, aspectRatio: "64:27", refreshHz: 25, pixelClockKhz: 90000 },
  { vic: 88, name: "2560x1080@30Hz 64:27", hActive: 2560, vActive: 1080, interlaced: false, aspectRatio: "64:27", refreshHz: 30, pixelClockKhz: 118800 },
  { vic: 89, name: "2560x1080@50Hz 64:27", hActive: 2560, vActive: 1080, interlaced: false, aspectRatio: "64:27", refreshHz: 50, pixelClockKhz: 185625 },
  { vic: 90, name: "2560x1080@60Hz 64:27", hActive: 2560, vActive: 1080, interlaced: false, aspectRatio: "64:27", refreshHz: 60, pixelClockKhz: 198000 },
  { vic: 91, name: "2560x1080@100Hz 64:27", hActive: 2560, vActive: 1080, interlaced: false, aspectRatio: "64:27", refreshHz: 100, pixelClockKhz: 371250 },
  { vic: 92, name: "2560x1080@120Hz 64:27", hActive: 2560, vActive: 1080, interlaced: false, aspectRatio: "64:27", refreshHz: 120, pixelClockKhz: 495000 },
  { vic: 93, name: "3840x2160@24Hz 16:9", hActive: 3840, vActive: 2160, interlaced: false, aspectRatio: "16:9", refreshHz: 24, pixelClockKhz: 297000 },
  { vic: 94, name: "3840x2160@25Hz 16:9", hActive: 3840, vActive: 2160, interlaced: false, aspectRatio: "16:9", refreshHz: 25, pixelClockKhz: 297000 },
  { vic: 95, name: "3840x2160@30Hz 16:9", hActive: 3840, vActive: 2160, interlaced: false, aspectRatio: "16:9", refreshHz: 30, pixelClockKhz: 297000 },
  { vic: 96, name: "3840x2160@50Hz 16:9", hActive: 3840, vActive: 2160, interlaced: false, aspectRatio: "16:9", refreshHz: 50, pixelClockKhz: 594000 },
  { vic: 97, name: "3840x2160@60Hz 16:9", hActive: 3840, vActive: 2160, interlaced: false, aspectRatio: "16:9", refreshHz: 60, pixelClockKhz: 594000 },
  { vic: 98, name: "4096x2160@24Hz 256:135", hActive: 4096, vActive: 2160, interlaced: false, aspectRatio: "256:135", refreshHz: 24, pixelClockKhz: 297000 },
  { vic: 99, name: "4096x2160@25Hz 256:135", hActive: 4096, vActive: 2160, interlaced: false, aspectRatio: "256:135", refreshHz: 25, pixelClockKhz: 297000 },
  { vic: 100, name: "4096x2160@30Hz 256:135", hActive: 4096, vActive: 2160, interlaced: false, aspectRatio: "256:135", refreshHz: 30, pixelClockKhz: 297000 },
  { vic: 101, name: "4096x2160@50Hz 256:135", hActive: 4096, vActive: 2160, interlaced: false, aspectRatio: "256:135", refreshHz: 50, pixelClockKhz: 594000 },
  { vic: 102, name: "4096x2160@60Hz 256:135", hActive: 4096, vActive: 2160, interlaced: false, aspectRatio: "256:135", refreshHz: 60, pixelClockKhz: 594000 },
  { vic: 103, name: "3840x2160@24Hz 64:27", hActive: 3840, vActive: 2160, interlaced: false, aspectRatio: "64:27", refreshHz: 24, pixelClockKhz: 297000 },
  { vic: 104, name: "3840x2160@25Hz 64:27", hActive: 3840, vActive: 2160, interlaced: false, aspectRatio: "64:27", refreshHz: 25, pixelClockKhz: 297000 },
  { vic: 105, name: "3840x2160@30Hz 64:27", hActive: 3840, vActive: 2160, interlaced: false, aspectRatio: "64:27", refreshHz: 30, pixelClockKhz: 297000 },
  { vic: 106, name: "3840x2160@50Hz 64:27", hActive: 3840, vActive: 2160, interlaced: false, aspectRatio: "64:27", refreshHz: 50, pixelClockKhz: 594000 },
  { vic: 107, name: "3840x2160@60Hz 64:27", hActive: 3840, vActive: 2160, interlaced: false, aspectRatio: "64:27", refreshHz: 60, pixelClockKhz: 594000 },
  { vic: 108, name: "1280x720@48Hz 16:9", hActive: 1280, vActive: 720, interlaced: false, aspectRatio: "16:9", refreshHz: 48, pixelClockKhz: 90000 },
  { vic: 109, name: "1280x720@48Hz 64:27", hActive: 1280, vActive: 720, interlaced: false, aspectRatio: "64:27", refreshHz: 48, pixelClockKhz: 90000 },
  { vic: 110, name: "1680x720@48Hz 64:27", hActive: 1680, vActive: 720, interlaced: false, aspectRatio: "64:27", refreshHz: 48, pixelClockKhz: 99000 },
  { vic: 111, name: "1920x1080@48Hz 16:9", hActive: 1920, vActive: 1080, interlaced: false, aspectRatio: "16:9", refreshHz: 48, pixelClockKhz: 148500 },
  { vic: 112, name: "1920x1080@48Hz 64:27", hActive: 1920, vActive: 1080, interlaced: false, aspectRatio: "64:27", refreshHz: 48, pixelClockKhz: 148500 },
  { vic: 113, name: "2560x1080@48Hz 64:27", hActive: 2560, vActive: 1080, interlaced: false, aspectRatio: "64:27", refreshHz: 48, pixelClockKhz: 198000 },
  { vic: 114, name: "3840x2160@48Hz 16:9", hActive: 3840, vActive: 2160, interlaced: false, aspectRatio: "16:9", refreshHz: 48, pixelClockKhz: 594000 },
  { vic: 115, name: "4096x2160@48Hz 256:135", hActive: 4096, vActive: 2160, interlaced: false, aspectRatio: "256:135", refreshHz: 48, pixelClockKhz: 594000 },
  { vic: 116, name: "3840x2160@48Hz 64:27", hActive: 3840, vActive: 2160, interlaced: false, aspectRatio: "64:27", refreshHz: 48, pixelClockKhz: 594000 },
  { vic: 117, name: "3840x2160@100Hz 16:9", hActive: 3840, vActive: 2160, interlaced: false, aspectRatio: "16:9", refreshHz: 100, pixelClockKhz: 1188000 },
  { vic: 118, name: "3840x2160@120Hz 16:9", hActive: 3840, vActive: 2160, interlaced: false, aspectRatio: "16:9", refreshHz: 120, pixelClockKhz: 1188000 },
  { vic: 119, name: "3840x2160@100Hz 64:27", hActive: 3840, vActive: 2160, interlaced: false, aspectRatio: "64:27", refreshHz: 100, pixelClockKhz: 1188000 },
  { vic: 120, name: "3840x2160@120Hz 64:27", hActive: 3840, vActive: 2160, interlaced: false, aspectRatio: "64:27", refreshHz: 120, pixelClockKhz: 1188000 },
  { vic: 121, name: "5120x2160@24Hz 64:27", hActive: 5120, vActive: 2160, interlaced: false, aspectRatio: "64:27", refreshHz: 24, pixelClockKhz: 396000 },
  { vic: 122, name: "5120x2160@25Hz 64:27", hActive: 5120, vActive: 2160, interlaced: false, aspectRatio: "64:27", refreshHz: 25, pixelClockKhz: 396000 },
  { vic: 123, name: "5120x2160@30Hz 64:27", hActive: 5120, vActive: 2160, interlaced: false, aspectRatio: "64:27", refreshHz: 30, pixelClockKhz: 396000 },
  { vic: 124, name: "5120x2160@48Hz 64:27", hActive: 5120, vActive: 2160, interlaced: false, aspectRatio: "64:27", refreshHz: 48, pixelClockKhz: 742500 },
  { vic: 125, name: "5120x2160@50Hz 64:27", hActive: 5120, vActive: 2160, interlaced: false, aspectRatio: "64:27", refreshHz: 50, pixelClockKhz: 742500 },
  { vic: 126, name: "5120x2160@60Hz 64:27", hActive: 5120, vActive: 2160, interlaced: false, aspectRatio: "64:27", refreshHz: 60, pixelClockKhz: 742500 },
  { vic: 127, name: "5120x2160@100Hz 64:27", hActive: 5120, vActive: 2160, interlaced: false, aspectRatio: "64:27", refreshHz: 100, pixelClockKhz: 1485000 },
  { vic: 193, name: "5120x2160@120Hz 64:27", hActive: 5120, vActive: 2160, interlaced: false, aspectRatio: "64:27", refreshHz: 120, pixelClockKhz: 1485000 },
  { vic: 194, name: "7680x4320@24Hz 16:9", hActive: 7680, vActive: 4320, interlaced: false, aspectRatio: "16:9", refreshHz: 24, pixelClockKhz: 1188000 },
  { vic: 195, name: "7680x4320@25Hz 16:9", hActive: 7680, vActive: 4320, interlaced: false, aspectRatio: "16:9", refreshHz: 25, pixelClockKhz: 1188000 },
  { vic: 196, name: "7680x4320@30Hz 16:9", hActive: 7680, vActive: 4320, interlaced: false, aspectRatio: "16:9", refreshHz: 30, pixelClockKhz: 1188000 },
  { vic: 197, name: "7680x4320@48Hz 16:9", hActive: 7680, vActive: 4320, interlaced: false, aspectRatio: "16:9", refreshHz: 48, pixelClockKhz: 2376000 },
  { vic: 198, name: "7680x4320@50Hz 16:9", hActive: 7680, vActive: 4320, interlaced: false, aspectRatio: "16:9", refreshHz: 50, pixelClockKhz: 2376000 },
  { vic: 199, name: "7680x4320@60Hz 16:9", hActive: 7680, vActive: 4320, interlaced: false, aspectRatio: "16:9", refreshHz: 60, pixelClockKhz: 2376000 },
  { vic: 200, name: "7680x4320@100Hz 16:9", hActive: 7680, vActive: 4320, interlaced: false, aspectRatio: "16:9", refreshHz: 100, pixelClockKhz: 4752000 },
  { vic: 201, name: "7680x4320@120Hz 16:9", hActive: 7680, vActive: 4320, interlaced: false, aspectRatio: "16:9", refreshHz: 120, pixelClockKhz: 4752000 },
  { vic: 202, name: "7680x4320@24Hz 64:27", hActive: 7680, vActive: 4320, interlaced: false, aspectRatio: "64:27", refreshHz: 24, pixelClockKhz: 1188000 },
  { vic: 203, name: "7680x4320@25Hz 64:27", hActive: 7680, vActive: 4320, interlaced: false, aspectRatio: "64:27", refreshHz: 25, pixelClockKhz: 1188000 },
  { vic: 204, name: "7680x4320@30Hz 64:27", hActive: 7680, vActive: 4320, interlaced: false, aspectRatio: "64:27", refreshHz: 30, pixelClockKhz: 1188000 },
  { vic: 205, name: "7680x4320@48Hz 64:27", hActive: 7680, vActive: 4320, interlaced: false, aspectRatio: "64:27", refreshHz: 48, pixelClockKhz: 2376000 },
  { vic: 206, name: "7680x4320@50Hz 64:27", hActive: 7680, vActive: 4320, interlaced: false, aspectRatio: "64:27", refreshHz: 50, pixelClockKhz: 2376000 },
  { vic: 207, name: "7680x4320@60Hz 64:27", hActive: 7680, vActive: 4320, interlaced: false, aspectRatio: "64:27", refreshHz: 60, pixelClockKhz: 2376000 },
  { vic: 208, name: "7680x4320@100Hz 64:27", hActive: 7680, vActive: 4320, interlaced: false, aspectRatio: "64:27", refreshHz: 100, pixelClockKhz: 4752000 },
  { vic: 209, name: "7680x4320@120Hz 64:27", hActive: 7680, vActive: 4320, interlaced: false, aspectRatio: "64:27", refreshHz: 120, pixelClockKhz: 4752000 },
  { vic: 210, name: "10240x4320@24Hz 64:27", hActive: 10240, vActive: 4320, interlaced: false, aspectRatio: "64:27", refreshHz: 24, pixelClockKhz: 1485000 },
  { vic: 211, name: "10240x4320@25Hz 64:27", hActive: 10240, vActive: 4320, interlaced: false, aspectRatio: "64:27", refreshHz: 25, pixelClockKhz: 1485000 },
  { vic: 212, name: "10240x4320@30Hz 64:27", hActive: 10240, vActive: 4320, interlaced: false, aspectRatio: "64:27", refreshHz: 30, pixelClockKhz: 1485000 },
  { vic: 213, name: "10240x4320@48Hz 64:27", hActive: 10240, vActive: 4320, interlaced: false, aspectRatio: "64:27", refreshHz: 48, pixelClockKhz: 2970000 },
  { vic: 214, name: "10240x4320@50Hz 64:27", hActive: 10240, vActive: 4320, interlaced: false, aspectRatio: "64:27", refreshHz: 50, pixelClockKhz: 2970000 },
  { vic: 215, name: "10240x4320@60Hz 64:27", hActive: 10240, vActive: 4320, interlaced: false, aspectRatio: "64:27", refreshHz: 60, pixelClockKhz: 2970000 },
  { vic: 216, name: "10240x4320@100Hz 64:27", hActive: 10240, vActive: 4320, interlaced: false, aspectRatio: "64:27", refreshHz: 100, pixelClockKhz: 5940000 },
  { vic: 217, name: "10240x4320@120Hz 64:27", hActive: 10240, vActive: 4320, interlaced: false, aspectRatio: "64:27", refreshHz: 120, pixelClockKhz: 5940000 },
  { vic: 218, name: "4096x2160@100Hz 256:135", hActive: 4096, vActive: 2160, interlaced: false, aspectRatio: "256:135", refreshHz: 100, pixelClockKhz: 1188000 },
  { vic: 219, name: "4096x2160@120Hz 256:135", hActive: 4096, vActive: 2160, interlaced: false, aspectRatio: "256:135", refreshHz: 120, pixelClockKhz: 1188000 },
];

const BY_VIC = new Map<number, VicTiming>(TABLE.map((t) => [t.vic, t]));

export const VIC_TABLE = TABLE;

export function lookupVic(vic: number): VicTiming | undefined {
  return BY_VIC.get(vic);
}

/** Human label for a VIC, falling back to the bare code when unknown. */
export function describeVic(vic: number): string {
  const t = BY_VIC.get(vic);
  if (!t) return "VIC " + vic;
  return t.hActive + "x" + t.vActive + (t.interlaced ? "i" : "p") +
    " @ " + t.refreshHz + " Hz " + t.aspectRatio;
}
