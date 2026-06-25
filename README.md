# GapFlush Live Engine

GapFlush Live is an offline Electron desktop application for TPEM gap/flush file conversion and inspection monitoring.

It watches incoming source files, converts them into the FLAGS-compatible desired format, and shows operator status in a dashboard.

## Operator Use

1. Install the app using the Windows setup file.
2. Put raw `.txt` or `.csv` inspection files into the configured source folder.
3. Converted files are written to the configured desired/output folder.
4. Use the dashboard to see processed, warning, and failed files.

## Current Conversion Format

Output header:

```txt
VIN/BSN,Station,dd-mm-yyyy,HH:mm:ss
```

Output measurement rows:

```txt
MeasurementID,Status,FailureType,ActualValue,MinimumThreshold,MaximumThreshold
```

Example:

```txt
MAT878023TAF91284N,PRACTC2_V4,15-06-2026,10:55:01
L23G110AFV,P,NO,4.68,3.00,5.00
L23G110AMV,F,OF,-0.92,-4.00,-2.00
```

## Reliability Notes

- Header date/time can be detected even when order is swapped.
- Vendor rows can be parsed even when source columns are shuffled.
- Duplicate measurement rows are not repeated in the output.
- Blank actual values are preserved for NG/not-given records.
- The parser validates structure, not engineering/business logic.

## Development

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm start
```

Build Windows installer:

```bash
npm run build
```

## Project Structure

```txt
main.js                 Electron main process and conversion engine
preload.js              Safe bridge between Electron and renderer
src/index.html          Dashboard UI
src/renderer.js         Dashboard logic
Source_TXT_FILE/        Sample source files
Desired_TXT_FILE/       Sample converted files
package.json            App scripts and Electron Builder config
```