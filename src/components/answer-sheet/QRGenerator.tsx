import React from 'react';
import { QRCodeSVG } from 'qrcode.react';

export function QRGenerator({ payload, size = 100 }: { payload: string; size?: number }) {
  return (
    <div style={{ 
      backgroundColor: '#ffffff', 
      padding: '0px', 
      borderRadius: '0px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      height: '100%'
    }}>
      <QRCodeSVG
        value={payload}
        size={size}
        bgColor="#ffffff"
        fgColor="#000000"
        level="H"
        includeMargin={true}
        marginSize={1}
      />
    </div>
  );
}
