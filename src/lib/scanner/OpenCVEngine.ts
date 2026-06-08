import jsQR from 'jsqr';

export class OpenCVEngine {
  private cv: any;

  constructor(cvInstance: any) {
    this.cv = cvInstance;
  }

  /**
   * Detect corner markers (L-shaped black corners) to identify the paper boundaries
   * Returns the detected corners or null if not all 4 are found
   */
  private detectCornerMarkers(imageData: ImageData): { tl: [number, number]; tr: [number, number]; bl: [number, number]; br: [number, number] } | null {
    try {
      const src = this.cv.matFromImageData(imageData);
      const gray = new this.cv.Mat();
      const thresh = new this.cv.Mat();
      const contours = new this.cv.MatVector();
      const hierarchy = new this.cv.Mat();

      // Convert to grayscale
      this.cv.cvtColor(src, gray, this.cv.COLOR_RGBA2GRAY, 0);

      // Apply threshold to get pure black/white
      this.cv.threshold(gray, thresh, 200, 255, this.cv.THRESH_BINARY);

      // Find contours - corner markers are thick L-shaped black lines
      this.cv.findContours(thresh, contours, hierarchy, this.cv.RETR_EXTERNAL, this.cv.CHAIN_APPROX_SIMPLE);

      const height = src.rows;
      const width = src.cols;
      const cornerSize = Math.min(height, width) * 0.08; // ~8% of image is typical corner size
      
      let topLeft: [number, number] | null = null;
      let topRight: [number, number] | null = null;
      let bottomLeft: [number, number] | null = null;
      let bottomRight: [number, number] | null = null;

      // Look for black contours near the corners
      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const rect = this.cv.boundingRect(cnt);
        const area = this.cv.contourArea(cnt);

        // Corner markers should have substantial area
        if (area < 100) continue;

        const x = rect.x;
        const y = rect.y;
        const w = rect.width;
        const h = rect.height;

        // Top-left corner
        if (x < width * 0.15 && y < height * 0.15 && w > 15 && h > 15) {
          topLeft = [x + w / 2, y + h / 2];
        }
        // Top-right corner
        if (x > width * 0.85 && y < height * 0.15 && w > 15 && h > 15) {
          topRight = [x + w / 2, y + h / 2];
        }
        // Bottom-left corner
        if (x < width * 0.15 && y > height * 0.85 && w > 15 && h > 15) {
          bottomLeft = [x + w / 2, y + h / 2];
        }
        // Bottom-right corner
        if (x > width * 0.85 && y > height * 0.85 && w > 15 && h > 15) {
          bottomRight = [x + w / 2, y + h / 2];
        }
      }

      src.delete();
      gray.delete();
      thresh.delete();
      contours.delete();
      hierarchy.delete();

      // Return corners if all 4 are detected
      if (topLeft && topRight && bottomLeft && bottomRight) {
        return { tl: topLeft, tr: topRight, bl: bottomLeft, br: bottomRight };
      }
      
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Attempt to decode a QR code from the raw image data.
   * Returns the parsed JSON payload or null if no QR code found.
   */
  public decodeQR(imageData: ImageData): { studentId: string; examId: string } | null {
    try {
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      });

      if (!code || !code.data) {
        // Try with inverted image as fallback
        const inverted = this.invertImageData(imageData);
        const codeInv = jsQR(inverted.data, inverted.width, inverted.height, {
          inversionAttempts: 'dontInvert',
        });
        
        if (!codeInv || !codeInv.data) return null;

        const parsed = JSON.parse(codeInv.data);
        if (parsed.s && parsed.e) {
          return { studentId: parsed.s, examId: parsed.e };
        }
        return null;
      }

      // Try to parse the JSON payload: {"e": "exam_id", "s": "student_id"}
      const parsed = JSON.parse(code.data);
      if (parsed.s && parsed.e) {
        return { studentId: parsed.s, examId: parsed.e };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Invert image data (black becomes white, white becomes black)
   */
  private invertImageData(imageData: ImageData): ImageData {
    const data = new Uint8ClampedArray(imageData.data);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - data[i];     // R
      data[i + 1] = 255 - data[i + 1]; // G
      data[i + 2] = 255 - data[i + 2]; // B
      // Keep alpha unchanged
    }
    return new ImageData(data, imageData.width, imageData.height);
  }

  public processImage(imageData: ImageData, answerKey: any): any {
    try {
      // Step 0: Detect corner markers for instant validation
      const corners = this.detectCornerMarkers(imageData);
      if (!corners) {
        return { 
          success: false, 
          error: "Could not detect paper corners. Ensure the 4 black corner markers are visible and positioned at the edges." 
        };
      }

      // Step 1: Try to decode QR code for student identification
      const qrResult = this.decodeQR(imageData);
      if (!qrResult) {
        return { 
          success: false, 
          error: "Could not read QR code. Make sure the QR code in the top-right corner of the answer sheet is clearly visible." 
        };
      }

      // Step 2: Paper detection using OpenCV with corner markers
      const src = this.cv.matFromImageData(imageData);
      const gray = new this.cv.Mat();
      const blurred = new this.cv.Mat();
      const thresh = new this.cv.Mat();

      // Convert to grayscale
      this.cv.cvtColor(src, gray, this.cv.COLOR_RGBA2GRAY, 0);

      // Blur to reduce noise
      this.cv.GaussianBlur(gray, blurred, new this.cv.Size(5, 5), 0, 0, this.cv.BORDER_DEFAULT);

      // Use Canny for edge detection to find the paper outline
      this.cv.Canny(blurred, thresh, 75, 200, 3, false);

      // Find contours
      const contours = new this.cv.MatVector();
      const hierarchy = new this.cv.Mat();
      this.cv.findContours(thresh, contours, hierarchy, this.cv.RETR_EXTERNAL, this.cv.CHAIN_APPROX_SIMPLE);

      const imgArea = src.cols * src.rows;
      let maxArea = 0;
      let hasPaper = false;

      // Heuristic 1: Is there a large rectangular-ish contour? (The paper)
      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const area = this.cv.contourArea(cnt);
        if (area > maxArea) maxArea = area;

        // If a contour takes up more than 15% of the screen, it's likely our paper
        if (area > imgArea * 0.15) {
          hasPaper = true;
          break;
        }
      }

      // Heuristic 2: If we didn't find a clean paper edge, are there a LOT of contours? 
      // (An exam paper has hundreds of text characters and bubbles. A blank wall or empty desk does not).
      if (!hasPaper && contours.size() > 100 && maxArea > imgArea * 0.05) {
        hasPaper = true;
      }

      src.delete();
      gray.delete();
      blurred.delete();
      thresh.delete();
      contours.delete();
      hierarchy.delete();

      if (!hasPaper) {
        return { success: false, error: "No exam paper detected in frame. Please position the answer sheet within the camera view." };
      }

      // MOCK GRADING LOGIC (bubble detection placeholder):
      
      let totalPoints = 0;
      let earnedPoints = 0;
      const breakdown: Record<string, any> = {};

      answerKey.sections.forEach((section: any) => {
        section.items.forEach((item: any) => {
          const possible = item.points || 1;
          totalPoints += possible;
          
          // 80% chance to get it right (mock)
          const isCorrect = Math.random() > 0.2;
          const pointsEarned = isCorrect ? possible : 0;
          earnedPoints += pointsEarned;

          // Generate a fake marked answer
          let marked = item.answer;
          if (!isCorrect && section.type === 'mc') {
             const opts = ['A','B','C','D'].filter(x => x !== item.answer);
             marked = opts[Math.floor(Math.random() * opts.length)];
          } else if (!isCorrect && section.type === 'tf') {
             marked = item.answer === 'T' ? 'F' : 'T';
          }

          breakdown[`${section.name}_${item.num}`] = {
            marked,
            correct: item.answer,
            is_correct: isCorrect,
            points_earned: pointsEarned,
            points_possible: possible
          };
        });
      });

      return {
        success: true,
        score: earnedPoints,
        total: totalPoints,
        breakdown,
        studentId: qrResult!.studentId,
        examId: qrResult!.examId,
        debug_image: null
      };

    } catch (err) {
      console.error("OpenCV Processing Error:", err);
      return { success: false, error: "Failed to process image" };
    }
  }
}
