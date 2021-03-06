import React from 'react';
import { Button } from '@patternfly/react-core';
import { PlusIcon } from '@patternfly/react-icons';

import cockpit from 'cockpit';
import { ListingTable } from "../lib/cockpit-components-table.jsx";
import { ListingPanel } from '../lib/cockpit-components-listing-panel.jsx';
import ImageDetails from './ImageDetails.jsx';
import ImageUsedBy from './ImageUsedBy.jsx';
import { ImageRunModal } from './ImageRunModal.jsx';
import { ImageSearchModal } from './ImageSearchModal.jsx';
import { ImageDeleteModal } from './ImageDeleteModal.jsx';
import ImageRemoveErrorModal from './ImageRemoveErrorModal.jsx';
import * as client from './client.js';

import './Images.css';

const moment = require('moment');
const _ = cockpit.gettext;

class Images extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            imageDetail: undefined,
            selectImageDeleteModal: false,
            setImageRemoveErrorModal: false,
            imageWillDelete: {},
            intermediateOpened: false,
        };

        this.deleteImage = this.deleteImage.bind(this);
        this.downloadImage = this.downloadImage.bind(this);
        this.handleCancelImageDeleteModal = this.handleCancelImageDeleteModal.bind(this);
        this.handleRemoveImage = this.handleRemoveImage.bind(this);
        this.handleCancelImageRemoveError = this.handleCancelImageRemoveError.bind(this);
        this.handleForceRemoveImage = this.handleForceRemoveImage.bind(this);
        this.renderRow = this.renderRow.bind(this);
    }

    deleteImage(image) {
        this.setState((prevState) => ({
            selectImageDeleteModal: !prevState.selectImageDeleteModal,
            imageWillDelete: image,
        }));
    }

    downloadImage(imageName, imageTag, system) {
        let pullImageId = imageName;
        if (imageTag)
            pullImageId += ":" + imageTag;

        this.setState({ imageDownloadInProgress: imageName });
        client.pullImage(system, pullImageId)
                .then(() => {
                    this.setState({ imageDownloadInProgress: undefined });
                })
                .catch(ex => {
                    const error = cockpit.format(_("Failed to download image $0:$1"), imageName, imageTag || "latest");
                    const errorDetail = (<>
                        <p> {_("Error message")}:
                            <samp>{cockpit.format("$0 $1", ex.message, ex.reason)}</samp>
                        </p>
                    </>);
                    this.setState({ imageDownloadInProgress: undefined });
                    this.props.onAddNotification({ type: 'danger', error, errorDetail });
                });
    }

    handleCancelImageDeleteModal() {
        this.setState((prevState) => ({
            selectImageDeleteModal: !prevState.selectImageDeleteModal
        }));
    }

    handleRemoveImage(tags, all) {
        const image = this.state.imageWillDelete.Id;
        this.setState({
            selectImageDeleteModal: false,
        });
        if (all)
            client.delImage(this.state.imageWillDelete.isSystem, image, false)
                    .catch(ex => {
                        this.imageRemoveErrorMsg = ex.message;
                        this.setState({
                            setImageRemoveErrorModal: true,
                        });
                    });
        else {
            // Call another untag once previous one resolved. Calling all at once can result in undefined behavior
            const tag = tags.shift();
            const i = tag.lastIndexOf(":");
            client.untagImage(this.state.imageWillDelete.isSystem, image, tag.substring(0, i), tag.substring(i + 1, tag.length))
                    .then(() => {
                        if (tags.length > 0)
                            this.handleRemoveImage(tags, all);
                    })
                    .catch(console.log);
        }
    }

    handleForceRemoveImage() {
        const id = this.state.imageWillDelete ? this.state.imageWillDelete.Id : "";
        client.delImage(this.state.imageWillDelete.isSystem, id, true)
                .then(reply => {
                    this.setState({
                        setImageRemoveErrorModal: false
                    });
                })
                .catch(ex => console.error("Failed to do RemoveImageForce call:", JSON.stringify(ex)));
    }

    renderRow(image) {
        const tabs = [];

        const runImage = (
            <div>
                <Button key={image.Id + "create"}
                    variant='secondary'
                    onClick={ e => {
                        e.stopPropagation();
                        this.setState({ showRunImageModal: image });
                    } }
                    aria-label={_("Run image")}
                    data-image={image.Id}>
                    <span className="fa fa-play" />
                </Button>
            </div>
        );
        const columns = [
            { title: image.RepoTags ? image.RepoTags[0] : "<none>:<none>", header: true },
            moment(image.Created, "YYYY-MM-DDTHH:mm:ss.SZ").calendar(),
            cockpit.format_bytes(image.Size),
            image.isSystem ? _("system") : this.props.user.name,
            runImage,
        ];

        tabs.push({
            name: _("Details"),
            renderer: ImageDetails,
            data: { image: image }
        });
        tabs.push({
            name: _("Used By"),
            renderer: ImageUsedBy,
            data: {
                containers: this.props.imageContainerList !== null ? this.props.imageContainerList[image.Id + image.isSystem.toString()] : null,
                showAll: this.props.showAll,
            }
        });

        const actions = [
            <Button
                variant="danger"
                key={image.Id + "delete"}
                className="btn-delete"
                aria-label={_("Delete image")}
                onClick={() => this.deleteImage(image)}>
                <span className="pficon pficon-delete" />
            </Button>
        ];
        return {
            expandedContent: <ListingPanel
                                colSpan='4'
                                listingActions={actions}
                                tabRenderers={tabs} />,
            columns: columns,
            rowId: image.Id + image.isSystem.toString(),
            props: { key :image.Id + image.isSystem.toString() },
        };
    }

    handleCancelImageRemoveError() {
        this.setState({
            setImageRemoveErrorModal: false
        });
    }

    render() {
        const columnTitles = [_("Name"), _("Created"), _("Size"), _("Owner"), ''];
        let emptyCaption = _("No images");
        if (this.props.images === null)
            emptyCaption = "Loading...";
        else if (this.props.textFilter.length > 0)
            emptyCaption = _("No images that match the current filter");
        const getNewImageAction = [
            <Button variant="secondary" key="get-new-image-action"
                    onClick={() => this.setState({ showSearchImageModal: true })}
                    className="pull-right"
                    icon={<PlusIcon />}>
                {_("Get new image")}
            </Button>
        ];

        const intermediateOpened = this.state.intermediateOpened;

        let filtered = [];
        if (this.props.images !== null) {
            filtered = Object.keys(this.props.images).filter(id => {
                if (this.props.ownerFilter !== "all") {
                    if (this.props.ownerFilter === "system" && !this.props.images[id].isSystem)
                        return false;
                    if (this.props.ownerFilter !== "system" && this.props.images[id].isSystem)
                        return false;
                }
                const tags = this.props.images[id].RepoTags || [];
                if (!intermediateOpened && tags.length < 1)
                    return false;
                if (this.props.textFilter.length > 0)
                    return tags.some(tag => tag.toLowerCase().indexOf(this.props.textFilter.toLowerCase()) >= 0);
                return true;
            });
        }

        filtered.sort((a, b) => {
            // User images are in front of system ones
            if (this.props.images[a].isSystem !== this.props.images[b].isSystem)
                return this.props.images[a].isSystem ? 1 : -1;
            const name_a = this.props.images[a].RepoTags ? this.props.images[a].RepoTags[0] : "";
            const name_b = this.props.images[b].RepoTags ? this.props.images[b].RepoTags[0] : "";
            if (name_a === "")
                return 1;
            if (name_b === "")
                return -1;
            return name_a > name_b ? 1 : -1;
        });

        const imageRows = filtered.map(id => this.renderRow(this.props.images[id]));

        const interm = this.props.images && Object.keys(this.props.images).some(id => !this.props.images[id].RepoTags);
        let toggleIntermediate = "";
        if (interm) {
            toggleIntermediate = <span className="listing-action">
                <Button variant="link" onClick={() => this.setState({ intermediateOpened: !intermediateOpened })}>
                    {intermediateOpened ? _("Hide intermediate images") : _("Show intermediate images")}</Button>
            </span>;
        }

        const imageRemoveErrorModal =
            <ImageRemoveErrorModal
                    setImageRemoveErrorModal={this.state.setImageRemoveErrorModal}
                    handleCancelImageRemoveError={this.handleCancelImageRemoveError}
                    handleForceRemoveImage={this.handleForceRemoveImage}
                    imageWillDelete={this.state.imageWillDelete}
                    imageRemoveErrorMsg={this.imageRemoveErrorMsg}
            />;

        return (
            <>
                <ListingTable caption={_("Images")}
                    variant='compact'
                    emptyCaption={emptyCaption}
                    columns={columnTitles}
                    rows={imageRows}
                    actions={getNewImageAction}
                />
                {toggleIntermediate}
                {imageRemoveErrorModal}
                {this.state.selectImageDeleteModal &&
                <ImageDeleteModal
                    imageWillDelete={this.state.imageWillDelete}
                    handleCancelImageDeleteModal={this.handleCancelImageDeleteModal}
                    handleRemoveImage={this.handleRemoveImage} /> }
                {this.state.showRunImageModal &&
                <ImageRunModal
                    close={() => this.setState({ showRunImageModal: undefined })}
                    selinuxAvailable={this.props.selinuxAvailable}
                    image={this.state.showRunImageModal} /> }
                {this.state.showSearchImageModal &&
                <ImageSearchModal
                    close={() => this.setState({ showSearchImageModal: false })}
                    downloadImage={this.downloadImage}
                    user={this.props.user}
                    registries={this.props.registries}
                    userServiceAvailable={this.props.userServiceAvailable}
                    systemServiceAvailable={this.props.systemServiceAvailable} /> }
                {this.state.imageDownloadInProgress && <div className='download-in-progress'> {_("Pulling")} {this.state.imageDownloadInProgress}... </div>}
            </>
        );
    }
}

export default Images;
