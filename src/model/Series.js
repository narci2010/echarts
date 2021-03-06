import {__DEV__} from '../config';
import * as zrUtil from 'zrender/src/core/util';
import env from 'zrender/src/core/env';
import {
    formatTime,
    encodeHTML,
    addCommas,
    getTooltipMarker
} from '../util/format';
import * as modelUtil from '../util/model';
import ComponentModel from './Component';
import colorPaletteMixin from './mixin/colorPalette';
import {
    getLayoutParams,
    mergeLayoutParam
} from '../util/layout';
import {createTask} from '../stream/task';
import {
    getDatasetModel,
    makeDefaultEncode
} from '../data/helper/sourceHelper';

var inner = modelUtil.makeInner();

var SeriesModel = ComponentModel.extend({

    type: 'series.__base__',

    /**
     * @readOnly
     */
    seriesIndex: 0,

    // coodinateSystem will be injected in the echarts/CoordinateSystem
    coordinateSystem: null,

    /**
     * @type {Object}
     * @protected
     */
    defaultOption: null,

    /**
     * Data provided for legend
     * @type {Function}
     */
    // PENDING
    legendDataProvider: null,

    /**
     * Access path of color for visual
     */
    visualColorAccessPath: 'itemStyle.color',

    /**
     * Support merge layout params.
     * Only support 'box' now (left/right/top/bottom/width/height).
     * @type {string|Object} Object can be {ignoreSize: true}
     * @readOnly
     */
    layoutMode: null,

    init: function (option, parentModel, ecModel, extraOpt) {

        /**
         * @type {number}
         * @readOnly
         */
        this.seriesIndex = this.componentIndex;

        // this.settingTask = createTask();

        this.dataTask = createTask({
            count: dataTaskCount,
            reset: dataTaskReset
        }, {model: this});

        this.mergeDefaultAndTheme(option, ecModel);

        setDefaultEncode(this);

        var data = this.getInitialData(option, ecModel);

        if (__DEV__) {
            zrUtil.assert(data, 'getInitialData returned invalid data.');
        }

        /**
         * @type {module:echarts/data/List|module:echarts/data/Tree|module:echarts/data/Graph}
         * @private
         */
        inner(this).dataBeforeProcessed = data;

        // If we reverse the order (make data firstly, and then make
        // dataBeforeProcessed by cloneShallow), cloneShallow will
        // cause data.graph.data !== data when using
        // module:echarts/data/Graph or module:echarts/data/Tree.
        // See module:echarts/data/helper/linkList

        // ??? should not restoreData here? but called by echart?
        // this.restoreData();
    },

    /**
     * Util for merge default and theme to option
     * @param  {Object} option
     * @param  {module:echarts/model/Global} ecModel
     */
    mergeDefaultAndTheme: function (option, ecModel) {
        var layoutMode = this.layoutMode;
        var inputPositionParams = layoutMode
            ? getLayoutParams(option) : {};

        // Backward compat: using subType on theme.
        // But if name duplicate between series subType
        // (for example: parallel) add component mainType,
        // add suffix 'Series'.
        var themeSubType = this.subType;
        if (ComponentModel.hasClass(themeSubType)) {
            themeSubType += 'Series';
        }
        zrUtil.merge(
            option,
            ecModel.getTheme().get(this.subType)
        );
        zrUtil.merge(option, this.getDefaultOption());

        // Default label emphasis `show`
        modelUtil.defaultEmphasis(option, 'label', ['show']);

        this.fillDataTextStyle(option.data);

        if (layoutMode) {
            mergeLayoutParam(option, inputPositionParams, layoutMode);
        }
    },

    mergeOption: function (newSeriesOption, ecModel) {
        // this.settingTask.dirty();

        newSeriesOption = zrUtil.merge(this.option, newSeriesOption, true);
        this.fillDataTextStyle(newSeriesOption.data);

        var layoutMode = this.layoutMode;
        if (layoutMode) {
            mergeLayoutParam(this.option, newSeriesOption, layoutMode);
        }

        setDefaultEncode(this);

        var data = this.getInitialData(newSeriesOption, ecModel);
        // ??? set dirty on ecModel, becusue it will call mergeOption({})?
        this.dataTask.dirty();

        inner(this).dataBeforeProcessed = data;
    },

    fillDataTextStyle: function (data) {
        // Default data label emphasis `show`
        // FIXME Tree structure data ?
        // FIXME Performance ?
        if (data) {
            var props = ['show'];
            for (var i = 0; i < data.length; i++) {
                if (data[i] && data[i].label) {
                    modelUtil.defaultEmphasis(data[i], 'label', props);
                }
            }
        }
    },

    /**
     * Init a data structure from data related option in series
     * Must be overwritten
     */
    getInitialData: function () {},

    /**
     * Append data to list
     */
    appendData: function (params) {
        var data = this.getRawData();
        data.appendData(params.data);
    },

    /**
     * @param {string} [dataType]
     * @return {module:echarts/data/List}
     */
    getData: function (dataType) {
        var data = inner(this).data;
        return dataType == null ? data : data.getLinkedData(dataType);
    },

    /**
     * @param {module:echarts/data/List} data
     */
    setData: function (data) {
        inner(this).data = data;
    },

    /**
     * [Scenarios]:
     * (1) Provide source data directly:
     *     series: {
     *         encode: {...},
     *         dimensions: [...]
     *         data: [[...]]
     *     }
     * (2) Ignore datasetIndex means `datasetIndex: 0`,
     *     and the dimensions defination in dataset is used:
     *     series: {
     *         encode: {...}
     *     }
     * (3) Use different datasets, and the dimensions defination
     *     in dataset is used:
     *     series: {
     *         nodes: {datasetIndex: 1, encode: {...}},
     *         links: {datasetIndex: 2, encode: {...}}
     *     }
     *
     * Get data from series itself or datset.
     * @param {string} [dataAttr='data'] Or can be like 'nodes', 'links'
     * @return {Object}
     * {
     *      modelUID: <string> Not null/undefined.
     *      data: <Array> Not null/undefined.
     *      dimensionsDefine: <Array.<Object|string>> Original define, can be null/undefined.
     *      encodeDefine: <Object> Original define, can be null/undefined.
     * }
     */
    getSource: function (dataAttr) {
        dataAttr = dataAttr || 'data';

        var thisOption = this.option;
        var thisData = thisOption[dataAttr];
        var dimensionsDefine = thisOption.dimensions;
        var data;
        var modelUID;

        if (thisData && thisData.datasetIndex == null) {
            data = thisData;
            modelUID = this.uid;
        }
        else {
            var datasetModel = getDatasetModel(this);
            if (datasetModel) {
                var datasetOption = datasetModel.option;
                if (datasetOption) {
                    data = datasetOption[dataAttr];
                    modelUID = datasetModel.uid;
                    dimensionsDefine = datasetOption.dimensions;
                    dimensionsDefine && (dimensionsDefine = dimensionsDefine.slice());
                }
            }
        }

        return {
            modelUID: modelUID,
            data: data,
            dimensionsDefine: dimensionsDefine,
            encodeDefine: inner(this).encode
        };
    },

    /**
     * Get data before processed
     * @return {module:echarts/data/List}
     */
    getRawData: function () {
        return inner(this).dataBeforeProcessed;
    },

    /**
     * Coord dimension to data dimension.
     *
     * By default the result is the same as dimensions of series data.
     * But in some series data dimensions are different from coord dimensions (i.e.
     * candlestick and boxplot). Override this method to handle those cases.
     *
     * Coord dimension to data dimension can be one-to-many
     *
     * @param {string} coordDim
     * @return {Array.<string>} dimensions on the axis.
     */
    coordDimToDataDim: function (coordDim) {
        return modelUtil.coordDimToDataDim(this.getData(), coordDim);
    },

    /**
     * Convert data dimension to coord dimension.
     *
     * @param {string|number} dataDim
     * @return {string}
     */
    dataDimToCoordDim: function (dataDim) {
        return modelUtil.dataDimToCoordDim(this.getData(), dataDim);
    },

    /**
     * Get base axis if has coordinate system and has axis.
     * By default use coordSys.getBaseAxis();
     * Can be overrided for some chart.
     * @return {type} description
     */
    getBaseAxis: function () {
        var coordSys = this.coordinateSystem;
        return coordSys && coordSys.getBaseAxis && coordSys.getBaseAxis();
    },

    // FIXME
    /**
     * Default tooltip formatter
     *
     * @param {number} dataIndex
     * @param {boolean} [multipleSeries=false]
     * @param {number} [dataType]
     */
    formatTooltip: function (dataIndex, multipleSeries, dataType) {
        function formatArrayValue(value) {
            // ???
            // check: category-no-encode-has-axis-data in dataset.html
            var vertially = zrUtil.reduce(value, function (vertially, val, idx) {
                var dimItem = data.getDimensionInfo(idx);
                return vertially |= dimItem && dimItem.tooltip !== false && dimItem.tooltipName != null;
            }, 0);

            var result = [];
            var tooltipDims = modelUtil.otherDimToDataDim(data, 'tooltip');

            tooltipDims.length
                ? zrUtil.each(tooltipDims, function (dimIdx) {
                    setEachItem(data.get(dimIdx, dataIndex), dimIdx);
                })
                // By default, all dims is used on tooltip.
                : zrUtil.each(value, setEachItem);

            function setEachItem(val, dimIdx) {
                var dimInfo = data.getDimensionInfo(dimIdx);
                // If `dimInfo.tooltip` is not set, show tooltip.
                if (!dimInfo || dimInfo.otherDims.tooltip === false) {
                    return;
                }
                var dimType = dimInfo.type;
                var valStr = (vertially ? '- ' + (dimInfo.tooltipName || dimInfo.name) + ': ' : '')
                    + (dimType === 'ordinal'
                        ? val + ''
                        : dimType === 'time'
                        ? (multipleSeries ? '' : formatTime('yyyy/MM/dd hh:mm:ss', val))
                        : addCommas(val)
                    );
                valStr && result.push(encodeHTML(valStr));
            }

            return (vertially ? '<br/>' : '') + result.join(vertially ? '<br/>' : ', ');
        }

        var data = inner(this).data;

        var value = this.getRawValue(dataIndex);
        var formattedValue = zrUtil.isArray(value)
            ? formatArrayValue(value) : encodeHTML(addCommas(value));
        var name = data.getName(dataIndex);

        var color = data.getItemVisual(dataIndex, 'color');
        if (zrUtil.isObject(color) && color.colorStops) {
            color = (color.colorStops[0] || {}).color;
        }
        color = color || 'transparent';

        var colorEl = getTooltipMarker(color);

        var seriesName = this.name;
        // FIXME
        if (seriesName === '\0-') {
            // Not show '-'
            seriesName = '';
        }
        seriesName = seriesName
            ? encodeHTML(seriesName) + (!multipleSeries ? '<br/>' : ': ')
            : '';
        return !multipleSeries
            ? seriesName + colorEl
                + (name
                    ? encodeHTML(name) + ': ' + formattedValue
                    : formattedValue
                )
            : colorEl + seriesName + formattedValue;
    },

    /**
     * @return {boolean}
     */
    isAnimationEnabled: function () {
        if (env.node) {
            return false;
        }

        var animationEnabled = this.getShallow('animation');
        if (animationEnabled) {
            if (this.getData().count() > this.getShallow('animationThreshold')) {
                animationEnabled = false;
            }
        }
        return animationEnabled;
    },

    restoreData: function () {
        this.dataTask.dirty();
    },

    getColorFromPalette: function (name, scope) {
        var ecModel = this.ecModel;
        // PENDING
        var color = colorPaletteMixin.getColorFromPalette.call(this, name, scope);
        if (!color) {
            color = ecModel.getColorFromPalette(name, scope);
        }
        return color;
    },

    /**
     * Get data indices for show tooltip content. See tooltip.
     * @abstract
     * @param {Array.<string>|string} dim
     * @param {Array.<number>} value
     * @param {module:echarts/coord/single/SingleAxis} baseAxis
     * @return {Object} {dataIndices, nestestValue}.
     */
    getAxisTooltipData: null,

    /**
     * See tooltip.
     * @abstract
     * @param {number} dataIndex
     * @return {Array.<number>} Point of tooltip. null/undefined can be returned.
     */
    getTooltipPosition: null,

    /**
     * @see {module:echarts/stream/Scheduler}
     */
    pipeTask: null,

    /**
     * Convinient for override in extended class.
     * @protected
     * @type {Function}
     */
    preventIncremental: null,

    /**
     * @public
     * @readOnly
     * @type {Object}
     */
    pipelineContext: null

});

zrUtil.mixin(SeriesModel, modelUtil.dataFormatMixin);
zrUtil.mixin(SeriesModel, colorPaletteMixin);

function dataTaskCount(context) {
    return context.model.getRawData().count();
}

function dataTaskReset(context) {
    var seriesModel = context.model;
    seriesModel.setData(context.outputData = seriesModel.getRawData().cloneShallow());
    return dataTaskProgress;
}

function dataTaskProgress(param, context) {
    context.model.getRawData().cloneShallow(context.outputData);
}

function setDefaultEncode(seriesModel) {
    inner(seriesModel).encode = getOptionEncode(seriesModel)
        || makeDefaultEncode(seriesModel);
}

function getOptionEncode(seriesModel) {
    var thisOption = seriesModel.option;
    var thisData = thisOption.data;
    return thisData && thisData.encode || thisOption.encode;
}

export default SeriesModel;