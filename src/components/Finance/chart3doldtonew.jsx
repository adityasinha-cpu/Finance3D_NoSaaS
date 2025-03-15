import React, { useState, useEffect } from "react";
import {
    CameraController,
    EDrawMeshAs,
    GradientColorPalette,
    HeatmapLegend,
    MouseWheelZoomModifier3D,
    NumberRange,
    NumericAxis3D,
    OrbitModifier3D,
    ResetCamera3DModifier,
    SciChart3DSurface,
    SurfaceMeshRenderableSeries3D,
    TooltipModifier3D,
    UniformGridDataSeries3D,
    Vector3,
    zeroArray2D,
    SciChartSurface,
    ISciChart3DSurface,
    IHeatmapLegend,
    IWasmContext
} from "scichart";

// Define props interface for TypeScript
interface SurfaceChartProps {
    ticker?: string;
    year?: number;
}

// Polygon.io API response types
interface PolygonDailyBar {
    c: number;      // close price
    h: number;      // high price
    l: number;      // low price
    o: number;      // open price
    t: number;      // timestamp
    v: number;      // volume
    vw: number;     // volume weighted price
}

interface PolygonResponse {
    ticker: string;
    queryCount: number;
    resultsCount: number;
    adjusted: boolean;
    results: PolygonDailyBar[];
    status: string;
    request_id: string;
    count: number;
}

const SurfaceChart: React.FC<SurfaceChartProps> = ({ ticker = "AAPL", year = 2024 }) => {
    // State for chart elements and data
    const [chartDiv, setChartDiv] = useState<HTMLDivElement | null>(null);
    const [legendDiv, setLegendDiv] = useState<HTMLDivElement | null>(null);
    const [mainChart, setMainChart] = useState<ISciChart3DSurface | null>(null);
    const [legendChart, setLegendChart] = useState<IHeatmapLegend | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    // Initialize community license once
    useEffect(() => {
        SciChartSurface.UseCommunityLicense();
    }, []);

    // Second step: Initialize chart 
    useEffect(() => {
        // Only proceed if DOM elements exist
        if (!chartDiv || !legendDiv) {
            return;
        }

        console.log("Initializing chart");
        setIsLoading(true);

        const initCharts = async (): Promise<void> => {
            try {
                // Create main chart
                const { sciChart3DSurface, wasmContext } = await SciChart3DSurface.create(chartDiv);

                // Set camera for better viewing oriented to see months going outward on z-axis
                sciChart3DSurface.camera = new CameraController(wasmContext, {
                    position: new Vector3(-120, 100, -100),
                    target: new Vector3(15, 50, 6),
                });

                // Set world dimensions and background
                sciChart3DSurface.worldDimensions = new Vector3(200, 100, 200);
                sciChart3DSurface.background = "Transparent";

                // Create axes with financial labels
                sciChart3DSurface.xAxis = new NumericAxis3D(wasmContext, {
                    axisTitle: "Day of Month",
                    visibleRange: new NumberRange(0, 30)
                });

                sciChart3DSurface.yAxis = new NumericAxis3D(wasmContext, {
                    axisTitle: "Price ($)",
                    // We'll set the range after loading data
                });

                // Create z-axis with month names
                const zAxis = new NumericAxis3D(wasmContext, {
                    axisTitle: "Month",
                    visibleRange: new NumberRange(0, 11)
                });

                // Configure axis to display month names instead of numbers
                const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                zAxis.labelProvider.formatLabel = (dataValue: number): string => {
                    const monthIndex = Math.round(dataValue);
                    return monthIndex >= 0 && monthIndex < 12 ? monthNames[monthIndex] : "";
                };

                sciChart3DSurface.zAxis = zAxis;

                // Fixed parameters for the data grid
                const months = 12;
                const days = 31;
                const basePrice = 0; // Use 0 as placeholder for missing data

                // Get API key from .env file (handled by Vite automatically)
                const apiKey = import.meta.env.VITE_POLYGON_API_KEY;

                if (!apiKey) {
                    throw new Error("Polygon API key not found in .env file");
                }

                // Fetch real stock data from Polygon.io
                // We'll get daily data for the entire year
                const startDate = `${year}-01-01`;
                const endDate = `${year}-12-31`;

                const apiUrl = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${startDate}/${endDate}?adjusted=true&apiKey=${apiKey}`;

                console.log(`Fetching data for ${ticker} from ${startDate} to ${endDate}`);
                const response = await fetch(apiUrl);

                if (!response.ok) {
                    throw new Error(`API error: ${response.status} ${response.statusText}`);
                }

                const data: PolygonResponse = await response.json();

                if (!data.results || data.results.length === 0) {
                    throw new Error(`No data available for ${ticker} in ${year}`);
                }

                console.log(`Received ${data.results.length} data points for ${ticker}`);

                // Initialize grid with base values - following StockGridVisualizer approach
                const priceData: number[][] = Array(months).fill(0).map(() => Array(days).fill(basePrice));

                // Track min/max values
                let minPrice = Number.MAX_VALUE;
                let maxPrice = Number.MIN_VALUE;

                // Fill grid with actual data
                data.results.forEach(dayData => {
                    const date = new Date(dayData.t);
                    const month = date.getMonth(); // 0-11
                    const day = date.getDate() - 1; // 0-30

                    // Store closing price in grid
                    priceData[month][day] = dayData.c;

                    // Track min/max prices
                    minPrice = Math.min(minPrice, dayData.c);
                    maxPrice = Math.max(maxPrice, dayData.c);
                });

                // Fill in missing values within months using the same approach as StockGridVisualizer
                for (let m = 0; m < months; m++) {
                    let lastKnownPrice: number | null = null;

                    // Forward fill - use previous known price
                    for (let d = 0; d < days; d++) {
                        if (priceData[m][d] !== basePrice) {
                            lastKnownPrice = priceData[m][d];
                        } else if (lastKnownPrice !== null) {
                            priceData[m][d] = lastKnownPrice;
                        }
                    }

                    // Backward fill - for start of month
                    lastKnownPrice = null;
                    for (let d = days - 1; d >= 0; d--) {
                        if (priceData[m][d] !== basePrice) {
                            lastKnownPrice = priceData[m][d];
                        } else if (lastKnownPrice !== null && priceData[m][d] === basePrice) {
                            priceData[m][d] = lastKnownPrice;
                        }
                    }
                }

                // Fill in completely empty months by copying from nearest month with data
                for (let m = 0; m < months; m++) {
                    // Check if month has any real data
                    let hasData = priceData[m].some(price => price !== basePrice);

                    if (!hasData) {
                        let nearestMonth = -1;
                        let minDistance = months;

                        // Find nearest month with data
                        for (let mm = 0; mm < months; mm++) {
                            if (mm === m) continue;

                            if (priceData[mm].some(price => price !== basePrice)) {
                                const distance = Math.abs(mm - m);
                                if (distance < minDistance) {
                                    minDistance = distance;
                                    nearestMonth = mm;
                                }
                            }
                        }

                        // Copy from nearest month if found
                        if (nearestMonth !== -1) {
                            for (let d = 0; d < days; d++) {
                                priceData[m][d] = priceData[nearestMonth][d];
                            }
                        }
                    }
                }

                // Final calculation of min/max across entire grid
                for (let m = 0; m < months; m++) {
                    for (let d = 0; d < days; d++) {
                        if (priceData[m][d] !== basePrice) {
                            minPrice = Math.min(minPrice, priceData[m][d]);
                            maxPrice = Math.max(maxPrice, priceData[m][d]);
                        }
                    }
                }

                // Ensure we have valid min/max
                if (!isFinite(minPrice) || !isFinite(maxPrice)) {
                    minPrice = 0;
                    maxPrice = 1000;
                }

                // Ensure sufficient range
                if (maxPrice - minPrice < 10) {
                    maxPrice = minPrice + 10;
                }

                console.log(`Price range for ${ticker}: $${minPrice.toFixed(2)} to $${maxPrice.toFixed(2)}`);

                // Update Y axis range to match the data
                sciChart3DSurface.yAxis.visibleRange = new NumberRange(minPrice * 0.9, maxPrice * 1.1);

                // Create data series
                const dataSeries = new UniformGridDataSeries3D(wasmContext, {
                    yValues: priceData,
                    xStep: 1, // 1 day per step
                    zStep: 1, // 1 month per step
                    dataSeriesName: `${ticker} Price Surface (${year})`,
                    xStart: 0, // Start at day 0
                    zStart: 0 // Start at month 0
                });

                // Use the working colors
                const colorMap = new GradientColorPalette(wasmContext, {
                    gradientStops: [
                        { offset: 0, color: "#1E5631" },   // Dark green (low values)
                        { offset: 0.25, color: "#A2D149" }, // Light green
                        { offset: 0.5, color: "#FFFF99" },  // Yellow
                        { offset: 0.75, color: "#FF9933" }, // Orange
                        { offset: 1, color: "#CC3300" },    // Red (high values)
                    ],
                });

                // Create surface series with financial styling
                const series = new SurfaceMeshRenderableSeries3D(wasmContext, {
                    dataSeries,
                    minimum: minPrice,
                    maximum: maxPrice,
                    opacity: 0.9,
                    cellHardnessFactor: 1.0,
                    shininess: 30,
                    lightingFactor: 0.6,
                    highlight: 1.0,
                    stroke: "#444444",
                    strokeThickness: 1.0,
                    contourStroke: "#FFFFFF",
                    contourInterval: (maxPrice - minPrice) / 10, // 10 contour lines
                    contourOffset: 0,
                    contourStrokeThickness: 1,
                    drawSkirt: false,
                    drawMeshAs: EDrawMeshAs.SOLID_WIREFRAME,
                    meshColorPalette: colorMap
                });

                sciChart3DSurface.renderableSeries.add(series);

                // Add modifiers for interaction
                sciChart3DSurface.chartModifiers.add(new MouseWheelZoomModifier3D());
                sciChart3DSurface.chartModifiers.add(new OrbitModifier3D());
                sciChart3DSurface.chartModifiers.add(new ResetCamera3DModifier());
                sciChart3DSurface.chartModifiers.add(new TooltipModifier3D({
                    tooltipContainerBackground: "#333333"
                }));

                // Store chart reference
                setMainChart(sciChart3DSurface);

                // Create legend with the working color configuration
                try {
                    const { heatmapLegend } = await HeatmapLegend.create(legendDiv, {
                        colorMap: {
                            minimum: minPrice,
                            maximum: maxPrice,
                            gradientStops: [
                                { offset: 0, color: "#1E5631" },   // Dark green (low values)
                                { offset: 0.25, color: "#A2D149" }, // Light green
                                { offset: 0.5, color: "#FFFF99" },  // Yellow
                                { offset: 0.75, color: "#FF9933" }, // Orange
                                { offset: 1, color: "#CC3300" },    // Red (high values)
                            ],
                            background: "Transparent"
                        }
                    });

                    // Store legend reference
                    setLegendChart(heatmapLegend);
                } catch (err) {
                    console.warn("Non-critical error creating legend:", err);
                }

                console.log("Chart initialized successfully");
                console.log(dataSeries.getYValues());
                setIsLoading(false);
            } catch (initError) {
                console.error("Error initializing chart:", initError);
                setError("Chart initialization error: " + (initError instanceof Error ? initError.message : String(initError)));
                setIsLoading(false);
            }
        };

        initCharts();

        // Cleanup function
        return () => {
            if (mainChart) {
                try {
                    mainChart.delete();
                } catch (e) {
                    console.warn("Error cleaning up main chart:", e);
                }
            }
            if (legendChart) {
                try {
                    legendChart.delete();
                } catch (e) {
                    console.warn("Error cleaning up legend chart:", e);
                }
            }
        };
    }, [chartDiv, legendDiv, ticker, year]);

    return (
        <div style={{ position: "relative", width: "100%", height: "550px" }}>
            <div
                ref={setChartDiv}
                style={{ height: "100%", width: "100%" }}
            />
            <div
                ref={setLegendDiv}
                style={{
                    position: "absolute",
                    height: "100%",
                    width: "65px",
                    top: "0px",
                    right: "0px",
                }}
            />
            {isLoading && (
                <div style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    backgroundColor: "rgba(0,0,
