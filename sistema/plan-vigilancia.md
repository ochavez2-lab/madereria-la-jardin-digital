# Plan de Vigilancia Inteligente: Maderería La Jardín (Tijuana)

## 1. Hardware Local (En el almacén)
- **Cerebro:** Mac Mini (Procesamiento de audio y video local)
- **Grabador (NVR):** Reolink (kit RLK8-810B4-A)
- **Disco:** WD Purple 4TB (Grabación 24/7)
- **Red:** Cable UTP Cat6 (100% Cobre)

---

## 2. Inventario de Cámaras y Ubicación

| ID | Modelo | Zona | Función Principal |
| :--- | :--- | :--- | :--- |
| PRO-1 | Reolink TrackMix PoE | Entrada (Verdes) | Seguimiento de personas y vehículos |
| PRO-2 | Reolink TrackMix PoE | Ventas/Tejeban (Morados/Amarillos) | Auditoría de audio en ventas |
| FIJA-1 | Reolink 4K (kit) | Esquina trasera 1 | Cobertura 24/7 zona riesgo |
| FIJA-2 | Reolink 4K (kit) | Esquina trasera 2 | Cobertura 24/7 zona riesgo |
| FIJA-3 | Reolink 4K (kit) | Pasillo secundario 1 | Punto ciego |
| FIJA-4 | Reolink 4K (kit) | Pasillo secundario 2 | Punto ciego |

---

## 3. Integración con IA (Claude Code)

### Auditoría de Audio (PRO-2)
- Captura audio ambiental bajo el tejeban
- Transcripción vía **Whisper** (local en Mac Mini)
- Comparación automática contra `precios_oficiales.md`
- Alerta si precio dicho ≠ precio oficial

### Seguridad Nocturna (FIJAS 1-4)
- Análisis de logs de movimiento en zonas rojas
- Alertas automáticas ante intrusión nocturna
- Sin procesamiento de video en tiempo real (solo logs de eventos)

### Perifoneo (PRO-1 y PRO-2)
- Mensajes automáticos programables
- Comunicación directa desde Mac Mini al piso de ventas

---

## 4. Archivos Clave en GitHub

| Archivo | Propósito |
| :--- | :--- |
| `sistema/precios_oficiales.md` | Base de datos de precios — fuente de verdad para auditoría |
| `sistema/protocolo_atencion.txt` | Guía paso a paso para empleado principiante |
| `sistema/registro_asistencia.log` | Log diario de eventos y asistencia |

---

## 5. Flujo de Auditoría (Módulo 2)

```
PRO-2 mic → audio raw
       ↓
   Whisper (Mac Mini local)
       ↓
   transcripción.txt
       ↓
   Claude compara vs precios_oficiales.md
       ↓
   ¿Discrepancia? → alerta al dueño
```
