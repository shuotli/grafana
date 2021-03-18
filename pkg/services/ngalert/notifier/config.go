package notifier

import (
	"fmt"
	"io/ioutil"
	"os"
	"path/filepath"

	"github.com/pkg/errors"
	"github.com/prometheus/alertmanager/config"
	"gopkg.in/yaml.v2"
)

type Config struct {
	Alertmanager *config.Config
	Templates    map[string]string `yaml:"template_files"`
}

func (c Config) PersistTemplates(path string) ([]string, bool, error) {
	if len(c.Templates) < 1 {
		return nil, false, nil
	}

	var templatesChanged bool
	paths := make([]string, 0, len(c.Templates))
	for name, content := range c.Templates {
		if name != filepath.Base(name) {
			return nil, false, fmt.Errorf("template file name '%s' is  not valid", name)
		}

		err := os.MkdirAll(path, 0755)
		if err != nil {
			return nil, false, fmt.Errorf("unable to create template directory %q: %s", path, err)
		}

		file := filepath.Join(path, name)
		paths = append(paths, file)

		// Check if the template file already exists and if it has changed
		if tmpl, err := ioutil.ReadFile(file); err == nil && string(tmpl) == content {
			// Templates file is the same we have, no-op and continue.
			continue
		} else if err != nil && !os.IsNotExist(err) {
			return nil, false, err
		}

		if err := ioutil.WriteFile(file, []byte(content), 0644); err != nil {
			return nil, false, fmt.Errorf("unable to create Alertmanager template file %q: %s", file, err)
		}

		templatesChanged = true
	}

	return paths, templatesChanged, nil
}

func parse(rawConfig string, rawTemplates string) (*Config, error) {
	r := &Config{}

	var err error
	r.Alertmanager, err = config.Load(rawConfig)
	if err != nil {
		return nil, errors.Wrap(err, "unable to parse Alertmanager configuration")
	}

	if err := yaml.Unmarshal([]byte(rawTemplates), r); err != nil {
		return nil, errors.Wrap(err, "unable to parse Alertmanager templates")
	}

	return r, nil
}
