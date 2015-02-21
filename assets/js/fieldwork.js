(function ($, window, document) {
    var Fieldwork = {
        AJAXCALLBACK:     0,
        SUBMITCALLBACK:   1,
        i:                {
            callbacks: []
        },
        //validators for fields
        validators:       {
            regex:    function (field, validator) {
                var match = /\/(.*)\/([a-z]*)/.exec(validator.pattern);
                return field.getValue().match(new RegExp(match[1], match[2]));
            },
            checkbox: function (field, validator) {
                return validator.checked === field.element.is(":checked");
            }
        },
        //validators for forms. naming should be improved
        formValidators:   {
            radio: function (form, validator) {
                var name = validator.inflictedFields[0];
                return $('[name="' + name + '"]:checked').length > 0;
            }
        },
        sanitizers:       {
            uppercase:  function (value, sanitizer) {
                return value.toUpperCase();
            },
            capitalize: function (value, sanitizer) {
                return value.replace(/(?:^|\s)\S/g, function (a) {
                    return a.toUpperCase();
                });
            },
            regexp:     function (value, sanitizer) {
                var patt = new RegExp(sanitizer.regexp, sanitizer.regexpmod);
                return value.replace(patt, sanitizer.replace);
            },
            iban:       function (value, sanitizer) {
                value = value.replace(/\s/g, '');
                if (!/[A-Z]{2}[0-9]{2}[A-Z]{4}/.test(value))
                    return value;
                var chunks = value.match(/.{1,4}/g);
                if (chunks === null)
                    return "";
                else
                    return chunks.join(" ");
            }
        },
        registerCallback: function (slug, on, fn) {
            this.i.callbacks.push({
                slug: slug,
                on:   on,
                fn:   fn
            });
            return this;
        },
        retrieveCallback: function (slug, on) {
            return _.findWhere(this.i.callbacks, {
                slug: slug,
                on:   on
            });
        },
        performCallback:  function (slug, on, form, data, e) {
            var callback = this.retrieveCallback(slug, on);
            if (callback !== undefined)
                callback.fn(form, data, e);
        },
        ajaxSubmitForm:   function (form) {
            $.ajax({
                url:      '/ajax/' + form.ajaxMethod + '/',
                data:     form.getValues(),
                dataType: 'json',
                type:     'POST',
                success:  function (data) {
                    Fieldwork.performCallback(
                        form.ajaxMethod,
                        Fieldwork.AJAXCALLBACK,
                        form,
                        data, {
                            type:    Fieldwork.AJAXCALLBACK,
                            instant: false
                        }
                    );
                },
                error:    function () {
                    if (console)
                        console.log('Fieldwork Ajax encountered an error');
                }
            });
        }
    };
    $(document).trigger("fieldwork-loaded", Fieldwork);
    function Form($form, formData) {
        this.slug = formData.slug;
        this.submitCallback = formData.submitCallback;
        this.hiddenFieldName = formData.hiddenFieldName;
        this.dataFields = formData.dataFields;
        this.element = $form;
        this.fields = [];
        this.validators = [];
        for (var n in formData.fields)
            this.fields.push(new Field(this, formData.fields[n]));
        for (var n in formData.liveValidators)
            this.validators.push(new Validator(this, formData.liveValidators[n]));
        var form = this;

        if ($.fn.inputActionOnEnter)
            $form.find('[data-input-action-on-enter]').inputActionOnEnter();

        $form.on({
            submit: function (e) {
                form.submit(e);
            }
        });
        Fieldwork.processForms();
    }

    $.extend(Form.prototype, {
        sanitize:       function () {
            for (var n in this.fields) {
                if (this.fields[n].sanitize) {
                    this.fields[n].sanitize(false);
                }
            }
        },
        validate:       function () {
            var fieldsValid = true;
            for (var n in this.fields) {
                if (this.fields[n].validate && !this.fields[n].validate())
                    fieldsValid = false;
            }
            if (fieldsValid)
                for (var n in this.validators)
                    if (!this.validators[n].validate())
                        break;
        },
        isValid:        function () {
            for (var n in this.fields)
                if (!this.fields[n].isValid())
                    return false;
            for (var n in this.validators)
                if (!this.validators[n].isValid())
                    return false;
            return true;
        },
        submit:         function (e) {
            this.sanitize();
            this.validate();
            if (!this.isValid()) {
                e.preventDefault();
                for (var n in this.fields)
                    if (this.fields[n].cancelSubmit)
                        this.fields[n].cancelSubmit();
                for (n in this.fields)
                    if (this.fields[n].isValid && !this.fields[n].isValid()) {
                        this.fields[n].element.focus().jtShow();
                        break;
                    }
            } else if (this.submitCallback !== "") {
                var fn = window[this.submitCallback];
                if (typeof fn === 'function')
                    fn(e, this);
            }
            Fieldwork.performCallback(this.slug, Fieldwork.SUBMITCALLBACK, this, null, e);
        },
        getValues:      function () {
            var values = {};
            values[this.hiddenFieldName] = "yes"; //force submit
            for (var n in this.fields)
                if (this.fields[n].hasValue())
                    values[this.fields[n].getName()] = this.fields[n].getValue();
            return values;
        },
        getFieldByName: function (name) {
            for (var n in this.fields)
                if (this.fields[n].getName() === name)
                    return this.fields[n];
            return false;
        }
    });
    function Validator(form, data) {
        this.form = form;
        this.method = data.method;
        this.error = data.error;
        this.data = data;
        this.inflictedFields = data.inflictedFields;
        this.valid = false;
    }

    $.extend(Validator.prototype, {
        validate: function () {
            this.valid = true;
            if (Fieldwork.formValidators[this.method])
                if (!((Fieldwork.formValidators[this.method])(this.form, this))) {
                    sweetAlert(this.error, "", "error");
                    this.valid = false;
                }
            return this.valid;
        },
        isValid:  function () {
            return this.valid;
        }
    });
    function Field(form, fieldData) {
        this.form = form;
        this.element = $("#" + fieldData.id);
        this.touched = false;
        this.valid = false;
        this.validators = fieldData.validators;
        this.sanitizers = fieldData.sanitizers;
        if (fieldData.hasOwnProperty('dtConfig')) {
            this.element.datetimepicker(fieldData.dtConfig);
        }
        this.isButton = fieldData.isButton === true;
        this.clicked = false;
        var field = this;
        this.element.on({
            blur:  function () {
                field.blur();
            },
            focus: function () {
                field.touched = true;
                field.element.addClass("input-touched");
            },
            click: function () {
                field.clicked = true;
            },
            keyup: function (e) {
                field.keyup(e, this);
            }
        });
        if (this.element.is('[type="checkbox"]'))
            this.element.on('change', function () {
                field.blur();
            });
    }

    $.extend(Field.prototype, {
        blur:         function () {
            if (!this.touched) return;
            this.sanitize(false);
            this.validate();
        },
        keyup:        function (e, field) {
            //this.sanitize(true);
        },
        cancelSubmit: function () {
            this.clicked = false;
        },
        validate:     function () {
            var val = this.getValue();
            var valid = true;
            for (var v in this.validators)
                if ((Fieldwork.validators[this.validators[v].method])) {
                    if (this.element.attr("placeholder") === val) val = ""; // TODO this is not quite right
                    if (!( (Fieldwork.validators[this.validators[v].method])(this, this.validators[v]) )) {
                        this.setInvalid(this.validators[v].error);
                        valid = false;
                        break;
                    }
                }
            if (valid)
                this.setValid();
            return valid;
        },
        sanitize:     function (realtime) {
            var val = this.getValue();
            var oldVal = val;
            for (var s in this.sanitizers)
                if ((Fieldwork.sanitizers[this.sanitizers[s].method]))
                    if (!realtime || this.sanitizers[s].realtime)
                        val = (Fieldwork.sanitizers[this.sanitizers[s].method])(val, this.sanitizers[s]);
            if (oldVal !== val)
                this.setValue(val);
        },
        getName:      function () {
            return this.element.attr('name');
        },
        hasValue:     function () {
            return (!this.isButton || this.clicked);
        },
        getValue:     function () {
            if (this.element.val() == this.element.attr('placeholder'))
                return '';
            return this.element.val();
        },
        setValue:     function (val) {
            this.element.val(val);
        },
        setInvalid:   function (error) {
            this.element.removeClass("valid").addClass("invalid");
            this.element.jtLink(error, ['focus'], []);
            this.valid = false;
        },
        setValid:     function () {
            this.element.removeClass("invalid");
            if (this.validators.length)
                this.element.addClass("valid");
            this.element.jtUnlink();
            this.valid = true;
        },
        isValid:      function () {
            return this.valid;
        }
    });
    $.fn.fieldwork = function (formData) {
        new Form($(this), formData);
    };
    Fieldwork.processForms = function () {
        $(".invisible-target-button:not(.processed)").each(function () {
            var $this = $(this);
            $this.addClass('processed');
            $("#target-" + $this.attr('id')).on({
                click: function () {
                    $this.click();
                }
            });
        });
    };
    $(function () {
        $('[data-input-mask]').each(function () {
            var $this = $(this);
            $this.mask($this.data('input-mask'));
        });
        Fieldwork.processForms();
    });
})(jQuery, window, document);