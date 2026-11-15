const LOGO_PATH = "/branding/ecochef-logo.png";

export type PdfLogo = { imageObject: string };

let cachedLogo: Promise<PdfLogo> | undefined;

/** Convert the existing transparent brand PNG to a PDF compatible JPEG image object. */
export function loadPdfLogo(): Promise<PdfLogo> {
  cachedLogo ??= new Promise<PdfLogo>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("The EcoChef logo could not be prepared for PDF export.");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0);
        const binary = atob(canvas.toDataURL("image/jpeg", 0.92).split(",")[1]);
        let hex = "";
        for (let index = 0; index < binary.length; index++) {
          hex += binary.charCodeAt(index).toString(16).padStart(2, "0");
        }
        resolve({
          imageObject: `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${hex.length + 1} >>\nstream\n${hex}>\nendstream`,
        });
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error("The EcoChef logo could not be loaded for PDF export."));
    image.src = LOGO_PATH;
  }).catch((error) => {
    cachedLogo = undefined;
    throw error;
  });
  return cachedLogo;
}

export function drawPdfLogo(x: number, y: number, width: number): string {
  const height = (width * 230) / 670;
  return `q ${width} 0 0 ${height.toFixed(2)} ${x} ${y} cm /Logo Do Q`;
}
